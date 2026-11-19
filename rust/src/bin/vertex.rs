use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use vertex_core::{
    AlgorithmId, Config, Demand, ExperimentPlan, Progress, ResearchResult, ResearchSession,
    Simulation, Snapshot, generate_demand, manual_calls,
};

#[derive(Deserialize)]
#[serde(untagged)]
enum Job {
    Simulation(Request),
    Research(ResearchRequest),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchRequest {
    config: Config,
    plan: ExperimentPlan,
    cancel_after: Option<usize>,
}

#[derive(Serialize)]
struct ResearchTrace {
    progress: Vec<Progress>,
    result: ResearchResult,
}

#[derive(Deserialize)]
struct Request {
    config: Config,
    algorithms: Vec<AlgorithmId>,
    demand: Option<Vec<Demand>>,
    commands: Vec<Command>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Command {
    Snapshot,
    Advance {
        time: f64,
    },
    Step,
    Run,
    Failure {
        id: usize,
    },
    CallFloors {
        floors: Vec<i32>,
        count: Option<usize>,
    },
    Inject {
        records: Vec<Demand>,
    },
    Seek {
        time: f64,
    },
}

#[derive(Serialize)]
struct Trace {
    traces: Vec<Vec<Snapshot>>,
    errors: Vec<Option<String>>,
}

fn execute_research(request: ResearchRequest) -> Result<ResearchTrace, String> {
    let mut session = ResearchSession::new(request.config, request.plan)?;
    let mut progress = Vec::new();
    let limit = request.cancel_after.unwrap_or(usize::MAX);
    while progress.len() < limit {
        let Some(trial) = session.step()? else { break };
        progress.push(trial);
    }
    let result = session.finish(progress.len() == limit)?;
    Ok(ResearchTrace { progress, result })
}

fn execute(request: Request) -> Result<Trace, String> {
    let demand = match request.demand {
        Some(demand) => demand,
        None => generate_demand(&request.config)?,
    };
    let initialize = || {
        request
            .algorithms
            .iter()
            .map(|&id| Simulation::new(request.config.clone(), id, Some(demand.clone())))
            .collect::<Result<Vec<_>, _>>()
    };
    let mut simulations = initialize()?;
    let mut trace = Trace {
        traces: vec![],
        errors: vec![],
    };
    let mut batch = 0_u32;
    for command in request.commands {
        let result = (|| {
            match command {
                Command::Snapshot => {}
                Command::Advance { time } => {
                    for sim in &mut simulations {
                        sim.advance(time)?;
                    }
                }
                Command::Step => {
                    if let Some((first, others)) = simulations.split_first_mut() {
                        let time = first.step()?.time;
                        for sim in others {
                            sim.advance(time)?;
                        }
                    }
                }
                Command::Run => {
                    for sim in &mut simulations {
                        sim.run_metrics()?;
                    }
                }
                Command::Failure { id } => {
                    for sim in &mut simulations {
                        sim.fail_car(id);
                    }
                }
                Command::CallFloors { floors, count } => {
                    if !simulations.is_empty() {
                        let now = simulations.iter().map(|sim| sim.time).fold(0.0, f64::max);
                        for sim in &mut simulations {
                            sim.advance(now)?;
                        }
                        let batch_id = batch;
                        batch = batch.wrapping_add(1);
                        let records = manual_calls(
                            &request.config,
                            now,
                            &floors,
                            count.unwrap_or(1),
                            batch_id,
                        )?;
                        for sim in &mut simulations {
                            sim.inject_passengers(&records)?;
                        }
                    }
                }
                Command::Inject { records } => {
                    for sim in &mut simulations {
                        sim.inject_passengers(&records)?;
                    }
                }
                Command::Seek { time } => {
                    simulations = initialize()?;
                    for sim in &mut simulations {
                        sim.advance(time)?;
                    }
                }
            }
            Ok(())
        })();
        trace.errors.push(result.err());
        trace
            .traces
            .push(simulations.iter().map(Simulation::snapshot).collect());
    }
    Ok(trace)
}

fn canonicalize_integers(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() => {
            let f = number.as_f64().unwrap();
            if f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_991.0 {
                *number = Number::from(f as i64);
            }
        }
        Value::Array(values) => values.iter_mut().for_each(canonicalize_integers),
        Value::Object(values) => values.values_mut().for_each(canonicalize_integers),
        _ => {}
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = if let Some(path) = std::env::args_os().nth(1) {
        std::fs::read_to_string(path)?
    } else {
        let mut input = String::new();
        io::stdin().lock().read_to_string(&mut input)?;
        input
    };
    let mut result = match serde_json::from_str(&fixture)? {
        Job::Simulation(request) => serde_json::to_value(execute(request)?)?,
        Job::Research(request) => serde_json::to_value(execute_research(request)?)?,
    };
    // JSON.stringify writes integral JS numbers without a decimal suffix.
    canonicalize_integers(&mut result);
    let mut output = io::BufWriter::new(io::stdout().lock());
    serde_json::to_writer(&mut output, &result)?;
    writeln!(output)?;
    Ok(())
}
