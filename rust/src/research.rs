use std::{
    collections::{HashMap, HashSet},
    hash::Hash,
};

use serde::{Deserialize, Serialize};

use crate::{AlgorithmId, Config, Demand, Metrics, Simulation, generate_demand, validate_config};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentPlan {
    pub floor_values: Vec<i32>,
    pub car_values: Vec<usize>,
    pub congestion_values: Vec<i32>,
    pub algorithms: Vec<AlgorithmId>,
    pub seeds: Vec<u32>,
    pub target_wait: f64,
    pub metric: String,
}

fn unique<T: Eq + Hash>(values: &[T]) -> bool {
    !values.is_empty() && values.iter().collect::<HashSet<_>>().len() == values.len()
}

pub fn validate_plan(plan: &ExperimentPlan) -> Result<usize, String> {
    if !unique(&plan.floor_values)
        || plan.floor_values.iter().any(|f| !(5..=100).contains(f))
        || !unique(&plan.car_values)
        || plan.car_values.iter().any(|c| !(1..=20).contains(c))
        || !unique(&plan.congestion_values)
        || plan
            .congestion_values
            .iter()
            .any(|c| !(0..=500).contains(c))
        || !unique(&plan.seeds)
    {
        return Err("층수·차량·혼잡도·Seed 범위가 잘못되었거나 중복되었습니다.".into());
    }
    if !unique(&plan.algorithms) {
        return Err("비교 알고리즘을 하나 이상 중복 없이 선택하세요.".into());
    }
    if !plan.target_wait.is_finite() || plan.target_wait < 0.0 {
        return Err("목표 대기시간은 0 이상이어야 합니다.".into());
    }
    let total = plan.floor_values.len() as u64
        * plan.car_values.len() as u64
        * plan.congestion_values.len() as u64
        * plan.seeds.len() as u64
        * plan.algorithms.len() as u64;
    if total > 40_000 {
        let text = total.to_string();
        let mut formatted = String::new();
        for (i, c) in text.chars().enumerate() {
            if i > 0 && (text.len() - i).is_multiple_of(3) {
                formatted.push(',');
            }
            formatted.push(c);
        }
        return Err(format!(
            "총 {formatted}회입니다. 한 실험은 40,000회 이하로 설정하세요."
        ));
    }
    Ok(total as usize)
}

pub fn dimension_config(
    base: &Config,
    floors: i32,
    cars: usize,
    congestion: i32,
    seed: u32,
) -> Result<Config, String> {
    let mut config = base.clone();
    config.floors = floors;
    config.cars = cars;
    config.congestion = f64::from(congestion);
    config.seed = i64::from(seed);
    let size = (floors + config.basements).max(0) as usize;
    let resize = |values: &[f64], default| {
        (0..size)
            .map(|i| values.get(i).copied().unwrap_or(default))
            .collect()
    };
    config.floor_weights = resize(&base.floor_weights, 1.0);
    config.floor_population = resize(&base.floor_population, 50.0);
    config.initial_queues = resize(&base.initial_queues, 0.0);
    let first = 1 - config.basements;
    let within = |floor: &i32| (first..=floors).contains(floor);
    config.lobby = first.max(config.lobby.min(floors));
    config.transfer_floors.retain(within);
    config.car.home = first.max(config.car.home.min(floors));
    config.car_overrides.truncate(cars);
    for car in config.car_overrides.iter_mut().flatten() {
        car.home = Some(first.max(car.home.unwrap_or(config.car.home).min(floors)));
        if let Some(service_floors) = &mut car.service_floors {
            service_floors.retain(within);
        }
    }
    if config
        .group_cars
        .iter()
        .try_fold(0usize, |sum, n| sum.checked_add(*n))
        != Some(cars)
    {
        config.group_cars.clear();
    }
    config.zone_count = config.zone_count.min(cars);
    config
        .zone_boundaries
        .retain(|&floor| floor >= first && floor < floors);
    if config.zone_boundaries.len() + 1 != config.zone_count {
        config.zone_boundaries.clear();
    }
    config.failure_car = config.failure_car.min(cars.saturating_sub(1));
    validate_config(&config)?;
    Ok(config)
}

#[derive(Debug, Clone, Serialize)]
pub struct Estimate {
    pub mean: f64,
    pub sd: f64,
    pub low: f64,
    pub high: f64,
    pub n: usize,
}

const T975: [f64; 31] = [
    0.0, 12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306004, 2.262157,
    2.228139, 2.200985, 2.178813, 2.160369, 2.144787, 2.13145, 2.119905, 2.109816, 2.100922,
    2.093024, 2.085963, 2.079614, 2.073873, 2.068658, 2.063899, 2.059539, 2.055529, 2.051831,
    2.048407, 2.04523, 2.042272,
];

pub fn summarize(values: &[f64]) -> Result<Estimate, String> {
    let n = values.len();
    if n == 0 || values.iter().any(|value| !value.is_finite()) {
        return Err("통계 입력은 유한한 관측값을 하나 이상 포함해야 합니다.".into());
    }
    let mean = values.iter().sum::<f64>() / n as f64;
    if n == 1 {
        return Ok(Estimate {
            mean,
            sd: 0.0,
            low: f64::NEG_INFINITY,
            high: f64::INFINITY,
            n,
        });
    }
    let df = n - 1;
    let sd = (values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / df as f64)
        .sqrt();
    let z = 1.95996398454_f64;
    let t = if df <= 30 {
        T975[df]
    } else {
        let df = df as f64;
        z + (z.powi(3) + z) / (4.0 * df)
            + (5.0 * z.powi(5) + 16.0 * z.powi(3) + 3.0 * z) / (96.0 * df.powi(2))
    };
    let half = t * sd / (n as f64).sqrt();
    Ok(Estimate {
        mean,
        sd,
        low: mean - half,
        high: mean + half,
        n,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRun {
    pub seed: u32,
    pub demand_hash: String,
    pub metrics: Metrics,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRow {
    pub floors: i32,
    pub cars: usize,
    pub congestion: i32,
    pub algorithm: AlgorithmId,
    pub wait: Estimate,
    pub p95: Estimate,
    pub throughput: Estimate,
    pub journey: Estimate,
    pub fairness: Estimate,
    pub energy: Estimate,
    pub unfinished: Estimate,
    pub queue_growth: Estimate,
    pub mean_wait: f64,
    pub p95_wait: f64,
    pub mean_throughput: f64,
    pub marginal_gain: Option<f64>,
    pub supply_margin: f64,
    pub bottleneck_relief: f64,
    pub runs: Vec<ResearchRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchResult {
    pub config: Config,
    pub plan: ExperimentPlan,
    pub rows: Vec<ResearchRow>,
    pub minimum_cars: Option<usize>,
    pub cancelled: bool,
}

#[derive(Serialize)]
pub struct Progress {
    pub completed: usize,
    pub total: usize,
    pub floors: i32,
    pub cars: usize,
    pub congestion: i32,
    pub algorithm: AlgorithmId,
    pub seed: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Grid {
    floors: i32,
    cars: usize,
    congestion: i32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct DemandSetup {
    grid: Grid,
    seed: u32,
}

pub struct ResearchSession {
    config: Config,
    plan: ExperimentPlan,
    trials: Vec<(DemandSetup, AlgorithmId)>,
    trial: usize,
    demand: Option<(DemandSetup, Config, Vec<Demand>)>,
    groups: Vec<((Grid, AlgorithmId), Vec<ResearchRun>)>,
    group_index: HashMap<(Grid, AlgorithmId), usize>,
}

impl ResearchSession {
    pub fn new(config: Config, plan: ExperimentPlan) -> Result<Self, String> {
        let total = validate_plan(&plan)?;
        let mut fleet_sizes = plan.car_values.clone();
        fleet_sizes.sort_unstable();
        let mut trials = Vec::with_capacity(total);
        for &floors in &plan.floor_values {
            for &cars in &fleet_sizes {
                for &congestion in &plan.congestion_values {
                    let grid = Grid {
                        floors,
                        cars,
                        congestion,
                    };
                    for &seed in &plan.seeds {
                        let setup = DemandSetup { grid, seed };
                        trials.extend(plan.algorithms.iter().map(|&algorithm| (setup, algorithm)));
                    }
                }
            }
        }
        Ok(Self {
            config,
            plan,
            trials,
            trial: 0,
            demand: None,
            groups: vec![],
            group_index: HashMap::new(),
        })
    }

    pub fn step(&mut self) -> Result<Option<Progress>, String> {
        let Some(&(setup, algorithm)) = self.trials.get(self.trial) else {
            return Ok(None);
        };
        let Grid {
            floors,
            cars,
            congestion,
        } = setup.grid;
        let seed = setup.seed;
        if self
            .demand
            .as_ref()
            .is_none_or(|(current, _, _)| *current != setup)
        {
            let config = dimension_config(&self.config, floors, cars, congestion, seed)?;
            let demand = generate_demand(&config)?;
            self.demand = Some((setup, config, demand));
        }
        let (_, config, demand) = self.demand.as_ref().unwrap();
        let mut simulation = Simulation::new(config.clone(), algorithm, Some(demand.clone()))?;
        let metrics = simulation.run_metrics()?;
        let run = ResearchRun {
            seed,
            demand_hash: simulation.demand_hash().into(),
            metrics,
        };
        let key = (setup.grid, algorithm);
        let index = *self.group_index.entry(key).or_insert_with(|| {
            self.groups.push((key, vec![]));
            self.groups.len() - 1
        });
        self.groups[index].1.push(run);
        self.trial += 1;
        Ok(Some(Progress {
            completed: self.trial,
            total: self.trials.len(),
            floors,
            cars,
            congestion,
            algorithm,
            seed,
        }))
    }

    pub fn finish(self, cancelled: bool) -> Result<ResearchResult, String> {
        let mut rows = Vec::with_capacity(self.groups.len());
        for (
            (
                Grid {
                    floors,
                    cars,
                    congestion,
                },
                algorithm,
            ),
            runs,
        ) in self.groups
        {
            let estimate = |metric: fn(&Metrics) -> f64| {
                summarize(
                    &runs
                        .iter()
                        .map(|run| metric(&run.metrics))
                        .collect::<Vec<_>>(),
                )
            };
            let wait = estimate(|m| m.mean_wait)?;
            let p95 = estimate(|m| m.p95_wait)?;
            let throughput = estimate(|m| m.throughput)?;
            rows.push(ResearchRow {
                floors,
                cars,
                congestion,
                algorithm,
                mean_wait: wait.mean,
                p95_wait: p95.mean,
                mean_throughput: throughput.mean,
                wait,
                p95,
                throughput,
                journey: estimate(|m| m.mean_journey)?,
                fairness: estimate(|m| m.fairness)?,
                energy: estimate(|m| m.energy)?,
                unfinished: estimate(|m| m.unfinished as f64)?,
                queue_growth: estimate(|m| m.queue_growth)?,
                supply_margin: estimate(|m| m.supply_margin)?.mean,
                marginal_gain: None,
                bottleneck_relief: 0.0,
                runs,
            });
        }
        for i in 0..rows.len() {
            let row = &rows[i];
            let comparable = || {
                rows.iter().filter(|other| {
                    other.floors == row.floors
                        && other.congestion == row.congestion
                        && other.algorithm == row.algorithm
                })
            };
            let previous = comparable()
                .filter(|other| other.cars < row.cars)
                .max_by_key(|other| other.cars);
            let marginal = previous
                .map(|other| (other.wait.mean - row.wait.mean) / (row.cars - other.cars) as f64);
            let baseline = comparable()
                .min_by_key(|other| other.cars)
                .unwrap()
                .unfinished
                .mean;
            let relief = if baseline > 0.0 {
                1.0 - row.unfinished.mean / baseline
            } else {
                0.0
            };
            rows[i].marginal_gain = marginal;
            rows[i].bottleneck_relief = relief;
        }
        let minimum_cars = rows
            .iter()
            .filter(|row| {
                row.wait.n >= 2
                    && row.wait.high <= self.plan.target_wait
                    && row.unfinished.mean == 0.0
            })
            .map(|row| row.cars)
            .min();
        Ok(ResearchResult {
            config: self.config,
            plan: self.plan,
            rows,
            minimum_cars,
            cancelled: cancelled && self.trial < self.trials.len(),
        })
    }
}
