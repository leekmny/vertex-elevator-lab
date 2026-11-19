use crate::{
    AlgorithmId, Config, ExperimentPlan, ResearchSession, Simulation, Snapshot, generate_demand,
    manual_calls,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;

thread_local! {
    static LIVE: RefCell<Live> = RefCell::new(Live::default());
    static RESEARCH: RefCell<Option<ResearchSession>> = const { RefCell::new(None) };
}

#[derive(Default)]
struct Live {
    simulations: Vec<Simulation>,
    call_batch: u32,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    Init {
        config: Config,
        algorithms: Vec<AlgorithmId>,
        time: Option<f64>,
    },
    Live {
        command: Command,
    },
    ResearchStart {
        config: Config,
        plan: ExperimentPlan,
    },
    ResearchStep,
    ResearchFinish {
        cancelled: bool,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Command {
    Advance {
        time: f64,
    },
    CallFloors {
        floors: Vec<i32>,
        count: Option<usize>,
    },
    Step,
    Failure {
        id: usize,
    },
}

impl Live {
    fn init(
        &mut self,
        config: Config,
        algorithms: Vec<AlgorithmId>,
        time: Option<f64>,
    ) -> Result<Vec<Snapshot>, String> {
        let demand = generate_demand(&config)?;
        let mut simulations = Vec::with_capacity(algorithms.len());
        for algorithm in algorithms {
            let mut simulation = Simulation::new(config.clone(), algorithm, Some(demand.clone()))?;
            if let Some(time) = time {
                simulation.advance(time)?;
            }
            simulations.push(simulation);
        }
        if time.is_none() {
            self.call_batch = 0;
        }
        self.simulations = simulations;
        Ok(self.snapshots())
    }

    fn snapshots(&self) -> Vec<Snapshot> {
        self.simulations.iter().map(Simulation::snapshot).collect()
    }

    fn command(&mut self, command: Command) -> Result<Vec<Snapshot>, String> {
        match command {
            Command::Advance { time } => {
                for simulation in &mut self.simulations {
                    simulation.advance(time)?;
                }
            }
            Command::CallFloors { floors, count } => {
                if let Some(first) = self.simulations.first() {
                    let time = self
                        .simulations
                        .iter()
                        .map(|s| s.time)
                        .fold(first.time, f64::max);
                    let config = first.config.clone();
                    for simulation in &mut self.simulations {
                        simulation.advance(time)?;
                    }
                    let batch = self.call_batch;
                    self.call_batch = self.call_batch.wrapping_add(1);
                    let records = manual_calls(&config, time, &floors, count.unwrap_or(1), batch)?;
                    for simulation in &mut self.simulations {
                        simulation.inject_passengers(&records)?;
                    }
                }
            }
            Command::Step => {
                if let Some((first, remaining)) = self.simulations.split_first_mut() {
                    let time = first.step()?.time;
                    for simulation in remaining {
                        simulation.advance(time)?;
                    }
                }
            }
            Command::Failure { id } => {
                for simulation in &mut self.simulations {
                    simulation.fail_car(id);
                }
            }
        }
        Ok(self.snapshots())
    }
}

fn run(request: Request) -> Result<Value, String> {
    let result = match request {
        Request::Init {
            config,
            algorithms,
            time,
        } => {
            let snapshots = LIVE.with(|live| live.borrow_mut().init(config, algorithms, time))?;
            serde_json::to_value(snapshots)
        }
        Request::Live { command } => {
            let snapshots = LIVE.with(|live| live.borrow_mut().command(command))?;
            serde_json::to_value(snapshots)
        }
        Request::ResearchStart { config, plan } => {
            let session = ResearchSession::new(config, plan)?;
            RESEARCH.with(|research| *research.borrow_mut() = Some(session));
            Ok(Value::Null)
        }
        Request::ResearchStep => {
            let progress = RESEARCH.with(|research| {
                let mut research = research.borrow_mut();
                let step = research
                    .as_mut()
                    .ok_or("Research session is not initialized")?
                    .step();
                if step.is_err() {
                    research.take();
                }
                step
            })?;
            serde_json::to_value(progress)
        }
        Request::ResearchFinish { cancelled } => {
            let result = RESEARCH.with(|research| {
                research
                    .borrow_mut()
                    .take()
                    .ok_or("Research session is not initialized")?
                    .finish(cancelled)
            })?;
            serde_json::to_value(result)
        }
    };
    result.map_err(|error| error.to_string())
}

#[unsafe(no_mangle)]
pub extern "C" fn vertex_alloc(length: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; length].into_boxed_slice()) as *mut u8
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn vertex_free(pointer: *mut u8, length: usize) {
    // Both request and response allocation use a boxed slice of exactly this length.
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            pointer, length,
        )))
    };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn vertex_request(pointer: *const u8, length: usize) -> u64 {
    // The worker supplies the live, initialized allocation returned by vertex_alloc.
    let input = unsafe { std::slice::from_raw_parts(pointer, length) };
    let response = match serde_json::from_slice(input)
        .map_err(|error| error.to_string())
        .and_then(run)
    {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    let bytes = response.to_string().into_bytes().into_boxed_slice();
    let len = bytes.len() as u64;
    ((Box::into_raw(bytes) as *mut u8 as u64) << 32) | len
}
