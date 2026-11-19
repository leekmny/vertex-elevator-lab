use std::collections::HashSet;

use crate::{Config, Demand, Motion, Scenario};

pub(crate) const DEMAND_LIMIT: usize = 300_000;
const DEMAND_LIMIT_ERROR: &str = "수요가 300,000명을 초과했습니다. 시간 또는 발생률을 줄이세요";

pub fn all_floors(c: &Config) -> Vec<i32> {
    (1 - c.basements..=c.floors).collect()
}

pub fn validate_config(c: &Config) -> Result<(), String> {
    for (name, value, min, max) in [
        ("floors", c.floors.into(), 5, 100),
        ("basements", c.basements.into(), 0, 10),
        ("cars", c.cars as f64, 1, 20),
        ("duration", c.duration, 1, 86_400),
        ("congestion", c.congestion, 0, 500),
        ("rate", c.rate, 0, 10_000),
        ("floorHeight", c.floor_height, 1, 10),
        ("warmup", c.warmup, 0, 86_400),
        ("maxDrain", c.max_drain, 0, 86_400),
    ] {
        if !value.is_finite() || value < f64::from(min) || value > f64::from(max) {
            return Err(format!("{name}: {min}~{max} 범위가 필요합니다"));
        }
    }
    if c.warmup >= c.duration {
        return Err("안정화 구간은 실험 시간보다 짧아야 합니다".into());
    }
    let floors = all_floors(c);
    if !floors.contains(&c.lobby) {
        return Err("로비 층이 범위를 벗어났습니다".into());
    }
    let specs: Vec<_> = (0..c.cars)
        .map(|i| {
            c.car
                .with_override(c.car_overrides.get(i).and_then(Option::as_ref))
        })
        .collect();
    for (i, spec) in specs.iter().enumerate() {
        for (name, value, positive) in [
            ("capacity", spec.capacity as f64, true),
            ("speed", spec.speed, true),
            ("acceleration", spec.acceleration, true),
            ("doorOpen", spec.door_open, false),
            ("doorClose", spec.door_close, false),
            ("boardTime", spec.board_time, false),
            ("alightTime", spec.alight_time, false),
        ] {
            if !value.is_finite() || value < 0.0 || (positive && value == 0.0) {
                return Err(format!("차량 {} {name} 값이 잘못되었습니다", i + 1));
            }
        }
    }
    let nonnegative = |value: &f64| value.is_finite() && *value >= 0.0;
    if [&c.floor_weights, &c.floor_population, &c.initial_queues]
        .into_iter()
        .any(|values| !values.iter().all(nonnegative))
    {
        return Err("층별 수요는 0 이상의 수여야 합니다".into());
    }
    if !c.group_cars.is_empty()
        && (c.group_cars.contains(&0)
            || c.group_cars
                .iter()
                .try_fold(0usize, |sum, n| sum.checked_add(*n))
                != Some(c.cars))
    {
        return Err("그룹별 차량 수의 합은 전체 차량 수와 같아야 합니다".into());
    }
    if ![
        c.weights.wait,
        c.weights.journey,
        c.weights.fairness,
        c.weights.energy,
        c.weights.balance,
    ]
    .iter()
    .all(nonnegative)
    {
        return Err("최적화 가중치는 0 이상이어야 합니다".into());
    }
    if !(1..=20).contains(&c.zone_count) {
        return Err("zoneCount must be 1..20".into());
    }
    for spec in specs {
        if !floors.contains(&spec.home) {
            return Err("home must be a building floor".into());
        }
        if spec
            .service_floors
            .is_some_and(|list| list.iter().any(|f| !floors.contains(f)))
        {
            return Err("serviceFloors outside building".into());
        }
    }
    if c.transfer_floors.iter().any(|f| !floors.contains(f)) {
        return Err("transfer floor outside building".into());
    }
    if c.zone_boundaries.iter().any(|f| !floors.contains(f))
        || c.zone_boundaries.windows(2).any(|pair| pair[1] <= pair[0])
    {
        return Err("zone boundaries must be ascending building floors".into());
    }
    Ok(())
}

pub(crate) struct Rng(u32);

impl Rng {
    pub(crate) fn new(seed: u32) -> Self {
        Self(seed)
    }
    pub(crate) fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut x = (self.0 ^ (self.0 >> 15)).wrapping_mul(self.0 | 1);
        x ^= x.wrapping_add((x ^ (x >> 7)).wrapping_mul(x | 61));
        f64::from(x ^ (x >> 14)) / 4_294_967_296.0
    }
    pub(crate) fn index(&mut self, len: usize) -> usize {
        (self.next() * len as f64) as usize
    }
}

struct DemandGenerator<'a> {
    config: &'a Config,
    floors: Vec<i32>,
    weights: Vec<f64>,
    total: f64,
    random: Rng,
    records: Vec<Demand>,
}

impl DemandGenerator<'_> {
    fn choose(&mut self) -> i32 {
        let mut value = self.random.next() * self.total;
        for (&floor, &weight) in self.floors.iter().zip(&self.weights) {
            value -= weight;
            if value <= 0.0 {
                return floor;
            }
        }
        *self.floors.last().unwrap()
    }

    fn other(&mut self, origin: i32) -> i32 {
        let mut destination = self.floors[self.random.index(self.floors.len())];
        if destination == origin {
            let index = (origin - self.floors[0]) as usize;
            destination = self.floors
                [(index + 1 + self.random.index(self.floors.len() - 1)) % self.floors.len()];
        }
        destination
    }

    fn add(&mut self, at: f64, forced: Option<i32>) -> Result<(), String> {
        if self.records.len() >= DEMAND_LIMIT {
            return Err(DEMAND_LIMIT_ERROR.into());
        }
        let mut origin = forced.unwrap_or_else(|| self.choose());
        let mut destination = self.other(origin);
        let lobby = self.config.lobby;
        match self.config.scenario {
            Scenario::Downpeak if self.random.next() < 0.85 => {
                if origin == lobby {
                    origin = self.other(lobby);
                }
                destination = lobby;
            }
            Scenario::Uppeak | Scenario::Lobby if self.random.next() < 0.9 => {
                origin = lobby;
                destination = self.other(origin);
            }
            Scenario::Hotspot if self.random.next() < 0.8 => {
                origin = self.floors[self.floors.len() - 2];
                destination = self.other(origin);
            }
            Scenario::Changing if at < self.config.duration / 2.0 => {
                origin = lobby;
                destination = self.other(origin);
            }
            Scenario::Changing => {
                if origin == lobby {
                    origin = self.other(lobby);
                }
                destination = lobby;
            }
            _ => {}
        }
        if let Some(floor) = forced {
            origin = floor;
            if destination == origin {
                destination = self.other(origin);
            }
        }
        self.records.push(Demand {
            id: self.records.len() as i64,
            at,
            origin,
            destination,
        });
        Ok(())
    }
}

pub fn generate_demand(config: &Config) -> Result<Vec<Demand>, String> {
    validate_config(config)?;
    let floors = all_floors(config);
    let initial: Vec<_> = (0..floors.len())
        .map(|i| config.initial_queues.get(i).copied().unwrap_or(0.0).ceil())
        .collect();
    if initial.iter().sum::<f64>() > DEMAND_LIMIT as f64 {
        return Err(DEMAND_LIMIT_ERROR.into());
    }
    let weights: Vec<_> = (0..floors.len())
        .map(|i| {
            config.floor_weights.get(i).unwrap_or(&1.0)
                * config.floor_population.get(i).unwrap_or(&50.0)
        })
        .collect();
    let mut generator = DemandGenerator {
        config,
        floors,
        total: weights.iter().sum(),
        weights,
        random: Rng::new(config.seed as u32),
        records: Vec::new(),
    };
    let floor_span = 1 - config.basements..=config.floors;
    for (floor, count) in floor_span.clone().zip(initial) {
        for _ in 0..count as usize {
            generator.add(0.0, Some(floor))?;
        }
    }
    if config.scenario == Scenario::Simultaneous {
        if config.congestion > 0.0 {
            for floor in floor_span {
                for _ in 0..(config.congestion / 10.0).round().max(1.0) as usize {
                    generator.add(0.0, Some(floor))?;
                }
            }
        }
    } else if config.rate > 0.0 && config.congestion > 0.0 && generator.total > 0.0 {
        let base = config.rate * config.congestion / 100.0 / 60.0;
        let mut time = 0.0;
        while time < config.duration {
            let segment = (time / 60.0_f64).floor();
            let factor = if config.scenario != Scenario::Changing {
                1.0
            } else if segment % 2.0 == 0.0 {
                0.5
            } else {
                1.5
            };
            let boundary = config.duration.min((segment + 1.0) * 60.0);
            // Use the same fdlibm logarithm as the JavaScript reference.
            let next =
                time - libm::log((1.0 - generator.random.next()).max(1e-12)) / (base * factor);
            if next >= boundary {
                time = boundary;
            } else {
                time = next;
                generator.add(time, None)?;
            }
        }
    }
    Ok(generator.records)
}

pub fn demand_hash(demand: &[Demand]) -> String {
    let mut hash = 2_166_136_261_u32;
    let mut time = ryu_js::Buffer::new();
    for p in demand {
        let row = format!(
            "{}:{}:{}:{};",
            p.id,
            time.format(p.at),
            p.origin,
            p.destination
        );
        for byte in row.bytes() {
            hash = (hash ^ u32::from(byte)).wrapping_mul(16_777_619);
        }
    }
    format!("{hash:08x}")
}

pub fn manual_calls(
    config: &Config,
    time: f64,
    floors: &[i32],
    count: usize,
    batch: u32,
) -> Result<Vec<Demand>, String> {
    let all = all_floors(config);
    if !time.is_finite()
        || time < 0.0
        || !(1..=20).contains(&count)
        || floors.iter().any(|f| !all.contains(f))
    {
        return Err("호출할 층이나 인원수가 잘못되었어요.".into());
    }
    let mut random = Rng::new(config.seed as u32 ^ batch.wrapping_add(1).wrapping_mul(0x45d9f3b));
    let mut seen = HashSet::new();
    let mut records = Vec::new();
    for &origin in floors.iter().filter(|&&floor| seen.insert(floor)) {
        let choices: Vec<_> = all
            .iter()
            .copied()
            .filter(|&floor| floor != origin)
            .collect();
        for _ in 0..count {
            let id = -(i64::from(batch) * 10_000 + records.len() as i64 + 1);
            records.push(Demand {
                id,
                at: time,
                origin,
                destination: choices[random.index(choices.len())],
            });
        }
    }
    Ok(records)
}

pub fn travel_time(distance: f64, speed: f64, acceleration: f64) -> f64 {
    if distance <= speed * speed / acceleration {
        2.0 * (distance / acceleration).sqrt()
    } else {
        distance / speed + speed / acceleration
    }
}

pub(crate) fn direction(delta: f64) -> i32 {
    i32::from(delta > 0.0) - i32::from(delta < 0.0)
}

pub fn position_at(m: &Motion, time: f64, floor_height: f64) -> f64 {
    if time <= m.start {
        return m.from;
    }
    if time >= m.end {
        return m.to.into();
    }
    let duration = m.end - m.start;
    let dt = time - m.start;
    let ta = (m.speed / m.acceleration).min(duration / 2.0);
    let peak = m.acceleration * ta;
    let x = if dt < ta {
        0.5 * m.acceleration * dt * dt
    } else if dt > duration - ta {
        m.distance - 0.5 * m.acceleration * (duration - dt).powi(2)
    } else {
        0.5 * m.acceleration * ta * ta + peak * (dt - ta)
    };
    m.from + f64::from(direction(f64::from(m.to) - m.from)) * x / floor_height
}
