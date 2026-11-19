use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlgorithmId {
    Fcfs,
    Nearest,
    Direction,
    Collective,
    Look,
    Scan,
    Eta,
    Journey,
    Static,
    Dynamic,
    Destination,
    Multi,
    Genetic,
    Annealing,
}

impl std::str::FromStr for AlgorithmId {
    type Err = String;
    fn from_str(id: &str) -> Result<Self, Self::Err> {
        serde_json::from_value(serde_json::Value::String(id.to_owned()))
            .map_err(|_| "Unknown dispatch algorithm".to_owned())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Policy {
    Shared,
    Parity,
    Zoned,
    Dynamic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scenario {
    Random,
    Downpeak,
    Uppeak,
    Simultaneous,
    Overload,
    Hotspot,
    Lobby,
    Interfloor,
    Failure,
    Changing,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Idle {
    Lobby,
    Middle,
    High,
    Predictive,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarSpec {
    pub capacity: usize,
    pub speed: f64,
    pub acceleration: f64,
    pub door_open: f64,
    pub door_close: f64,
    pub board_time: f64,
    pub alight_time: f64,
    pub home: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_floors: Option<Vec<i32>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceleration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub door_open: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub door_close: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alight_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_floors: Option<Vec<i32>>,
}

impl CarSpec {
    pub(crate) fn with_override(&self, changes: Option<&CarOverride>) -> Self {
        let Some(changes) = changes else {
            return self.clone();
        };
        Self {
            capacity: changes.capacity.unwrap_or(self.capacity),
            speed: changes.speed.unwrap_or(self.speed),
            acceleration: changes.acceleration.unwrap_or(self.acceleration),
            door_open: changes.door_open.unwrap_or(self.door_open),
            door_close: changes.door_close.unwrap_or(self.door_close),
            board_time: changes.board_time.unwrap_or(self.board_time),
            alight_time: changes.alight_time.unwrap_or(self.alight_time),
            home: changes.home.unwrap_or(self.home),
            service_floors: changes
                .service_floors
                .clone()
                .or_else(|| self.service_floors.clone()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Weights {
    pub wait: f64,
    pub journey: f64,
    pub fairness: f64,
    pub energy: f64,
    pub balance: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub floors: i32,
    pub basements: i32,
    pub cars: usize,
    pub floor_height: f64,
    pub duration: f64,
    pub warmup: f64,
    pub drain: bool,
    pub max_drain: f64,
    pub seed: i64,
    pub rate: f64,
    pub congestion: f64,
    pub scenario: Scenario,
    pub policy: Policy,
    pub zone_count: usize,
    pub zone_boundaries: Vec<i32>,
    pub group_cars: Vec<usize>,
    pub lobby: i32,
    pub transfer_floors: Vec<i32>,
    pub floor_weights: Vec<f64>,
    pub floor_population: Vec<f64>,
    pub initial_queues: Vec<f64>,
    pub car: CarSpec,
    #[serde(default)]
    pub car_overrides: Vec<Option<CarOverride>>,
    pub weights: Weights,
    pub idle: Idle,
    pub failure_at: f64,
    pub failure_car: usize,
    pub long_wait: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            floors: 20,
            basements: 0,
            cars: 2,
            floor_height: 3.5,
            duration: 600.0,
            warmup: 0.0,
            drain: false,
            max_drain: 3600.0,
            seed: 2026,
            rate: 24.0,
            congestion: 100.0,
            scenario: Scenario::Random,
            policy: Policy::Shared,
            zone_count: 2,
            zone_boundaries: vec![],
            group_cars: vec![],
            lobby: 1,
            transfer_floors: vec![1],
            floor_weights: vec![1.0; 20],
            floor_population: vec![50.0; 20],
            initial_queues: vec![0.0; 20],
            car: CarSpec {
                capacity: 12,
                speed: 2.5,
                acceleration: 1.0,
                door_open: 1.5,
                door_close: 1.5,
                board_time: 0.8,
                alight_time: 0.6,
                home: 1,
                service_floors: None,
            },
            car_overrides: vec![],
            weights: Weights {
                wait: 1.0,
                journey: 0.5,
                fairness: 1.0,
                energy: 0.1,
                balance: 0.3,
            },
            idle: Idle::Lobby,
            failure_at: 180.0,
            failure_car: 0,
            long_wait: 120.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Demand {
    pub id: i64,
    pub at: f64,
    pub origin: i32,
    pub destination: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PassengerState {
    Waiting,
    Onboard,
    Complete,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Passenger {
    #[serde(flatten)]
    pub demand: Demand,
    pub state: PassengerState,
    pub floor: i32,
    pub route: Vec<i32>,
    pub leg: usize,
    pub queued_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boarded_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub car_id: Option<usize>,
    pub wait: f64,
    pub ride: f64,
    pub transfers: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_boarded_at: Option<f64>,
}

impl Passenger {
    pub(crate) fn next_floor(&self) -> i32 {
        self.route[self.leg + 1]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Motion {
    pub from: f64,
    pub to: i32,
    pub start: f64,
    pub end: f64,
    pub distance: f64,
    pub acceleration: f64,
    pub speed: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CarStatus {
    Idle,
    Moving,
    Opening,
    Boarding,
    Closing,
    Failed,
    Retiring,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarState {
    pub id: usize,
    pub position: f64,
    pub direction: i32,
    pub status: CarStatus,
    pub passengers: Vec<i64>,
    pub stops: Vec<i32>,
    pub assigned: Vec<i64>,
    pub service_floors: Vec<i32>,
    pub spec: CarSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<Motion>,
    pub distance: f64,
    pub stops_count: usize,
    pub busy_time: f64,
    pub load_integral: f64,
    pub energy: f64,
    pub failure_pending: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub generated: usize,
    pub waiting: usize,
    pub onboard: usize,
    pub completed: usize,
    pub unboarded: usize,
    pub unfinished: usize,
    pub mean_wait: f64,
    pub median_wait: f64,
    pub p95_wait: f64,
    pub p99_wait: f64,
    pub max_wait: f64,
    pub mean_ride: f64,
    pub mean_journey: f64,
    pub throughput: f64,
    pub throughput5: f64,
    pub current_mean_wait: f64,
    pub oldest_wait: f64,
    pub max_queue: usize,
    pub distance: f64,
    pub energy: f64,
    pub stops: usize,
    pub stops_per_passenger: f64,
    pub fairness: f64,
    pub long_wait_ratio: f64,
    pub transferred: usize,
    pub direct_mean_journey: f64,
    pub transfer_mean_journey: f64,
    pub floor_queues: Vec<usize>,
    pub floor_waits: Vec<f64>,
    pub utilization: Vec<f64>,
    pub occupancy: Vec<f64>,
    pub wait_samples: Vec<f64>,
    pub queue_growth: f64,
    pub supply_margin: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub time: f64,
    pub mean_wait: f64,
    pub p95_wait: f64,
    pub queue: usize,
    pub completed: usize,
    pub demand: usize,
    pub positions: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LogEntry {
    pub time: f64,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub time: f64,
    pub done: bool,
    pub algorithm: AlgorithmId,
    pub cars: Vec<CarState>,
    pub passengers: Vec<Passenger>,
    pub metrics: Metrics,
    pub series: Vec<Sample>,
    pub logs: Vec<LogEntry>,
    pub events: usize,
    pub demand_hash: String,
}
