use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap, HashSet, VecDeque},
};

use crate::{
    AlgorithmId, CarState, CarStatus, Config, Demand, Idle, LogEntry, Motion, Passenger,
    PassengerState, Policy, Sample, Scenario, Snapshot,
    algorithms::{HallCall, optimize_assignments, score_car},
    input::{
        Rng, all_floors, demand_hash, direction, generate_demand, position_at, travel_time,
        validate_config,
    },
};

mod metrics;

const EVENT_LIMIT: usize = 10_000_000;

enum EventKind {
    Passenger(Demand),
    Dispatch,
    Arrive(usize, i32),
    Open(usize),
    Alight(usize, i64),
    Board(usize, Option<i64>),
    Closing(usize),
    Close(usize),
    Sample,
    Zone,
    Failure(usize),
}

impl EventKind {
    fn priority(&self) -> u8 {
        match self {
            Self::Failure(_) => 5,
            Self::Arrive(..) | Self::Open(_) | Self::Alight(..) | Self::Board(_, Some(_)) => 10,
            Self::Board(_, None) => 15,
            Self::Closing(_) => 16,
            Self::Passenger(_) | Self::Close(_) => 20,
            Self::Zone => 30,
            Self::Dispatch => 40,
            Self::Sample => 90,
        }
    }
}

struct Event {
    time: f64,
    sequence: usize,
    kind: EventKind,
}

impl Ord for Event {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap returns the largest item first. Reverse the event ordering.
        other
            .time
            .partial_cmp(&self.time)
            .unwrap_or(Ordering::Equal)
            .then_with(|| other.kind.priority().cmp(&self.kind.priority()))
            .then_with(|| other.sequence.cmp(&self.sequence))
    }
}

impl PartialOrd for Event {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Event {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Event {}

pub struct Simulation {
    pub config: Config,
    pub algorithm: AlgorithmId,
    pub time: f64,
    pub cars: Vec<CarState>,
    floors: Vec<i32>,
    queue: BinaryHeap<Event>,
    sequence: usize,
    processed: usize,
    // Keep arrival order for metrics, snapshots and predictive idle tie-breaking.
    people: Vec<Passenger>,
    people_index: HashMap<i64, usize>,
    known_ids: HashSet<i64>,
    demand_records: Vec<Demand>,
    series: Vec<Sample>,
    logs: VecDeque<LogEntry>,
    hash: String,
    random: Rng,
    last_account: f64,
    dispatch_at: Option<f64>,
    finished: bool,
    max_queue: usize,
    waiting_count: usize,
    horizon: f64,
    policy: Policy,
    repositioned: Vec<bool>,
}

impl Simulation {
    pub fn new(
        config: Config,
        algorithm: AlgorithmId,
        demand: Option<Vec<Demand>>,
    ) -> Result<Self, String> {
        validate_config(&config)?;
        let floors = all_floors(&config);
        let horizon = config.duration + if config.drain { config.max_drain } else { 0.0 };
        let policy = match algorithm {
            AlgorithmId::Static => Policy::Zoned,
            AlgorithmId::Dynamic => Policy::Dynamic,
            _ => config.policy,
        };
        let cars = (0..config.cars)
            .map(|id| {
                let spec = config
                    .car
                    .with_override(config.car_overrides.get(id).and_then(Option::as_ref));
                CarState {
                    id,
                    position: spec.home.into(),
                    direction: 0,
                    status: CarStatus::Idle,
                    passengers: vec![],
                    stops: vec![],
                    assigned: vec![],
                    service_floors: vec![],
                    spec,
                    motion: None,
                    distance: 0.0,
                    stops_count: 0,
                    busy_time: 0.0,
                    load_integral: 0.0,
                    energy: 0.0,
                    failure_pending: false,
                }
            })
            .collect();
        let mut sim = Self {
            config,
            algorithm,
            time: 0.0,
            cars,
            floors,
            queue: BinaryHeap::new(),
            sequence: 0,
            processed: 0,
            people: vec![],
            people_index: HashMap::new(),
            known_ids: HashSet::new(),
            demand_records: vec![],
            series: vec![],
            logs: VecDeque::new(),
            hash: String::new(),
            random: Rng::new(0),
            last_account: 0.0,
            dispatch_at: None,
            finished: false,
            max_queue: 0,
            waiting_count: 0,
            horizon,
            policy,
            repositioned: vec![],
        };
        sim.repositioned.resize(sim.config.cars, false);
        sim.random = Rng::new(sim.config.seed as u32 ^ 0x5a17);
        sim.allocate_zones(false)?;
        sim.check_connected()?;
        let records = match demand {
            Some(records) => records,
            None => generate_demand(&sim.config)?,
        };
        let duration = sim.config.duration;
        for &record in &records {
            if !sim.known_ids.insert(record.id)
                || !sim.floors.contains(&record.origin)
                || !sim.floors.contains(&record.destination)
                || record.origin == record.destination
                || record.at < 0.0
                || !record.at.is_finite()
            {
                return Err("Invalid passenger demand record".into());
            }
            if record.at <= duration {
                sim.add(record.at, EventKind::Passenger(record));
            }
        }
        sim.hash = demand_hash(&records);
        sim.demand_records = records;
        for t in (0..=horizon as usize).step_by(10) {
            sim.add(t as f64, EventKind::Sample);
        }
        if duration % 10.0 != 0.0 {
            sim.add(duration, EventKind::Sample);
        }
        if horizon % 10.0 != 0.0 && horizon != duration {
            sim.add(horizon, EventKind::Sample);
        }
        if policy == Policy::Dynamic {
            for t in (30..=horizon as usize).step_by(30) {
                sim.add(t as f64, EventKind::Zone);
            }
        }
        if sim.config.scenario == Scenario::Failure && sim.config.failure_at <= horizon {
            sim.add(
                sim.config.failure_at.max(0.0),
                EventKind::Failure(sim.config.failure_car),
            );
        }
        Ok(sim)
    }

    fn add(&mut self, time: f64, kind: EventKind) {
        if time <= self.horizon {
            self.queue.push(Event {
                time,
                sequence: self.sequence,
                kind,
            });
            self.sequence += 1;
        }
    }

    fn log(&mut self, kind: &'static str, message: String) {
        self.logs.push_back(LogEntry {
            time: self.time,
            kind,
            message,
        });
        if self.logs.len() > 100 {
            self.logs.pop_front();
        }
    }

    fn schedule_dispatch(&mut self) {
        if self.dispatch_at != Some(self.time) {
            self.dispatch_at = Some(self.time);
            self.add(self.time, EventKind::Dispatch);
        }
    }

    fn passenger(&self, id: i64) -> &Passenger {
        &self.people[self.people_index[&id]]
    }

    fn check_connected(&self) -> Result<(), String> {
        for &floor in &self.floors[1..] {
            self.route(self.floors[0], floor)?;
        }
        Ok(())
    }

    fn allocate_zones(&mut self, dynamic: bool) -> Result<(), String> {
        let config = &self.config;
        let floors = &self.floors;
        let zones = if self.policy == Policy::Parity {
            2.min(config.cars)
        } else {
            config.zone_count.min(config.cars).min(floors.len())
        };
        let previous: Vec<_> = if dynamic {
            self.cars
                .iter()
                .map(|car| car.service_floors.clone())
                .collect()
        } else {
            vec![]
        };
        let boundaries: Vec<_> = if dynamic {
            let mut loads = vec![1; floors.len()];
            for p in self
                .people
                .iter()
                .filter(|p| p.state == PassengerState::Waiting)
            {
                loads[(p.floor - floors[0]) as usize] += 1;
            }
            let total: usize = loads.iter().sum();
            let mut sum = 0;
            let mut next_zone = 1;
            let mut boundaries = Vec::with_capacity(zones - 1);
            for (&floor, load) in floors[..floors.len() - 1].iter().zip(loads) {
                if next_zone == zones {
                    break;
                }
                sum += load;
                if sum * zones >= total * next_zone {
                    boundaries.push(floor);
                    next_zone += 1;
                }
            }
            while boundaries.len() < zones - 1 {
                boundaries.push(floors[floors.len() - zones + boundaries.len()]);
            }
            boundaries.sort_unstable();
            boundaries
        } else if config.zone_boundaries.is_empty() {
            (1..zones)
                .map(|z| floors[(floors.len() * z).div_ceil(zones) - 1])
                .collect()
        } else {
            config.zone_boundaries.clone()
        };
        let groups: Vec<_> = if config.group_cars.len() == zones {
            config
                .group_cars
                .iter()
                .enumerate()
                .flat_map(|(group, &n)| std::iter::repeat_n(group, n))
                .collect()
        } else {
            (0..self.cars.len()).map(|i| i % zones).collect()
        };
        for (id, group) in groups.into_iter().enumerate() {
            let mut allowed: Vec<_> = floors
                .iter()
                .copied()
                .filter(|&floor| match self.policy {
                    Policy::Parity if config.cars > 1 => floor.unsigned_abs() as usize % 2 == group,
                    Policy::Zoned | Policy::Dynamic => {
                        boundaries
                            .iter()
                            .position(|&b| floor <= b)
                            .unwrap_or(zones - 1)
                            == group
                    }
                    _ => true,
                })
                .collect();
            if self.policy != Policy::Shared {
                allowed.push(config.lobby);
                allowed.extend(&config.transfer_floors);
            }
            let car = &self.cars[id];
            if let Some(service_floors) = &car.spec.service_floors {
                allowed.retain(|floor| service_floors.contains(floor));
            }
            for &person in car.passengers.iter().chain(&car.assigned) {
                let p = self.passenger(person);
                allowed.extend([p.floor, p.next_floor()]);
            }
            allowed.sort_unstable();
            allowed.dedup();
            self.cars[id].service_floors = allowed;
        }
        if dynamic {
            // Retain a physically capable provider when a boundary would strand a floor.
            for &floor in floors {
                if !self
                    .cars
                    .iter()
                    .any(|car| car.service_floors.contains(&floor))
                    && let Some(car) = self.cars.iter_mut().find(|car| {
                        car.spec
                            .service_floors
                            .as_ref()
                            .is_none_or(|list| list.contains(&floor))
                    })
                {
                    car.service_floors.push(floor);
                }
            }
            if self.check_connected().is_err() {
                for (car, old_floors) in self.cars.iter_mut().zip(previous) {
                    car.service_floors = old_floors;
                }
            }
            for index in 0..self.people.len() {
                let p = &self.people[index];
                if p.state == PassengerState::Waiting && p.car_id.is_none() {
                    let route = self.route(p.floor, p.demand.destination)?;
                    self.people[index].route = route;
                    self.people[index].leg = 0;
                }
            }
            self.log("zone", "대기 부하에 따른 구역 경계를 갱신했습니다".into());
        }
        Ok(())
    }

    fn route(&self, origin: i32, destination: i32) -> Result<Vec<i32>, String> {
        if self.cars.iter().any(|car| {
            car.service_floors.contains(&origin) && car.service_floors.contains(&destination)
        }) {
            return Ok(vec![origin, destination]);
        }
        // The service graph is physical capability. Failed cars may strand passengers in that graph.
        let index = |f: i32| (f - self.floors[0]) as usize;
        let mut previous = vec![None; self.floors.len()];
        previous[index(origin)] = Some(origin);
        let mut todo = VecDeque::from([origin]);
        while let Some(floor) = todo.pop_front() {
            if floor == destination {
                break;
            }
            for car in self
                .cars
                .iter()
                .filter(|car| car.service_floors.contains(&floor))
            {
                for &next in &car.service_floors {
                    if previous[index(next)].is_none() {
                        previous[index(next)] = Some(floor);
                        todo.push_back(next);
                    }
                }
            }
        }
        if previous[index(destination)].is_none() {
            return Err(format!("No service path: {origin} → {destination}"));
        }
        let mut path = vec![destination];
        while *path.last().unwrap() != origin {
            path.push(previous[index(*path.last().unwrap())].unwrap());
        }
        path.reverse();
        Ok(path)
    }

    fn account(&mut self, time: f64) {
        let dt = time - self.last_account;
        for car in &mut self.cars {
            if !matches!(car.status, CarStatus::Idle | CarStatus::Failed) {
                car.busy_time += dt;
            }
            car.load_integral += dt * car.passengers.len() as f64;
            if let Some(motion) = &car.motion {
                car.position = position_at(motion, time, self.config.floor_height);
            }
        }
        self.last_account = time;
    }

    fn dispatch(&mut self) {
        self.dispatch_at = None;
        let mut waiting: Vec<_> = self
            .people
            .iter()
            .enumerate()
            .filter(|(_, p)| p.state == PassengerState::Waiting && p.car_id.is_none())
            .map(|(index, _)| index)
            .collect();
        waiting.sort_by(|&a, &b| {
            let (a, b) = (&self.people[a], &self.people[b]);
            a.queued_at
                .partial_cmp(&b.queued_at)
                .unwrap_or(Ordering::Equal)
                .then_with(|| a.demand.id.cmp(&b.demand.id))
        });
        for batch in waiting.chunks(8) {
            let mut calls = Vec::with_capacity(8);
            let mut eligible = Vec::with_capacity(8);
            let mut passengers = Vec::with_capacity(8);
            for &index in batch {
                let p = &self.people[index];
                let next = p.next_floor();
                let candidates: Vec<_> = self
                    .cars
                    .iter()
                    .filter(|car| {
                        !car.failure_pending
                            && car.status != CarStatus::Failed
                            && car.service_floors.contains(&p.floor)
                            && car.service_floors.contains(&next)
                            && car.passengers.len() < car.spec.capacity
                    })
                    .map(|car| car.id)
                    .collect();
                if candidates.is_empty() {
                    continue;
                }
                passengers.push(index);
                eligible.push(candidates);
                calls.push(HallCall {
                    origin: p.floor,
                    direction: (next - p.floor).signum(),
                    queued_at: p.queued_at,
                    destination: (self.algorithm == AlgorithmId::Destination).then_some(next),
                });
            }
            if calls.is_empty() {
                continue;
            }
            let assignments = if matches!(
                self.algorithm,
                AlgorithmId::Genetic | AlgorithmId::Annealing
            ) {
                optimize_assignments(
                    self.algorithm,
                    &calls,
                    &eligible,
                    &self.cars,
                    self.time,
                    &self.config,
                    &mut self.random,
                )
            } else {
                calls
                    .iter()
                    .zip(&eligible)
                    .map(|(call, cars)| {
                        let score = |id| {
                            score_car(
                                self.algorithm,
                                &self.cars[id],
                                call,
                                self.time,
                                &self.config,
                            )
                        };
                        cars.iter()
                            .copied()
                            .reduce(|best, car| if score(car) < score(best) { car } else { best })
                            .unwrap()
                    })
                    .collect()
            };
            for (index, car) in passengers.into_iter().zip(assignments) {
                self.people[index].car_id = Some(car);
                self.cars[car].assigned.push(self.people[index].demand.id);
                self.repositioned[car] = false;
            }
        }
        for car in 0..self.cars.len() {
            self.update_stops(car);
            if self.cars[car].status == CarStatus::Idle {
                self.depart(car);
            }
        }
    }

    fn update_stops(&mut self, car: usize) {
        let mut assigned = std::mem::take(&mut self.cars[car].assigned);
        assigned.retain(|id| {
            self.people_index.get(id).is_some_and(|&index| {
                let p = &self.people[index];
                p.state == PassengerState::Waiting && p.car_id == Some(car)
            })
        });
        let mut seen = HashSet::new();
        self.cars[car].stops = self.cars[car]
            .passengers
            .iter()
            .map(|&id| self.passenger(id).next_floor())
            .chain(assigned.iter().map(|&id| self.passenger(id).floor))
            .filter(|&floor| seen.insert(floor))
            .collect();
        self.cars[car].assigned = assigned;
    }

    fn target(&mut self, car_id: usize) -> Option<i32> {
        self.update_stops(car_id);
        let car = &self.cars[car_id];
        let mut stops = car.stops.clone();
        if stops.is_empty() {
            return None;
        }
        if self.algorithm == AlgorithmId::Fcfs {
            return Some(car.passengers.first().map_or_else(
                || self.passenger(car.assigned[0]).floor,
                |&id| self.passenger(id).next_floor(),
            ));
        }
        let position = car.position;
        let mut dir = car.direction;
        if let Some(&first) = car.passengers.first() {
            let commits = direction(f64::from(self.passenger(first).next_floor()) - position);
            dir = if commits != 0 {
                commits
            } else if dir != 0 {
                dir
            } else {
                1
            };
            stops = car
                .passengers
                .iter()
                .map(|&id| self.passenger(id).next_floor())
                .collect();
            if car.passengers.len() < car.spec.capacity {
                stops.extend(
                    car.assigned
                        .iter()
                        .map(|&id| self.passenger(id))
                        .filter(|p| {
                            (p.next_floor() - p.floor).signum() == dir
                                && (f64::from(p.floor) - position) * f64::from(dir) >= 0.0
                        })
                        .map(|p| p.floor),
                );
            }
            self.cars[car_id].direction = dir;
        }
        if matches!(
            self.algorithm,
            AlgorithmId::Look
                | AlgorithmId::Scan
                | AlgorithmId::Collective
                | AlgorithmId::Direction
        ) {
            if dir == 0 {
                dir = direction(f64::from(stops[0]) - position);
                if dir == 0 {
                    dir = 1;
                }
                self.cars[car_id].direction = dir;
            }
            let ahead = stops
                .iter()
                .copied()
                .filter(|&floor| (f64::from(floor) - position) * f64::from(dir) >= 0.0)
                .min_by_key(|floor| floor * dir);
            if ahead.is_some() {
                return ahead;
            }
            if self.algorithm == AlgorithmId::Scan {
                let edge = self.cars[car_id]
                    .service_floors
                    .iter()
                    .copied()
                    .max_by_key(|floor| floor * dir);
                if edge.is_some_and(|floor| (f64::from(floor) - position).abs() > 0.00001) {
                    return edge;
                }
            }
            self.cars[car_id].direction = -dir;
            return stops.into_iter().min_by_key(|floor| -floor * dir);
        }
        stops.into_iter().reduce(|best, floor| {
            if (f64::from(floor) - position).abs() < (f64::from(best) - position).abs() {
                floor
            } else {
                best
            }
        })
    }

    fn depart(&mut self, car_id: usize) {
        let car = &mut self.cars[car_id];
        if car.status == CarStatus::Failed {
            return;
        }
        if car.failure_pending && car.passengers.is_empty() {
            car.status = CarStatus::Failed;
            car.direction = 0;
            self.log("failure", format!("E{} 안전 퇴역 완료", car_id + 1));
            return;
        }
        let target = match self.target(car_id) {
            Some(target) => target,
            None => {
                let car = &mut self.cars[car_id];
                car.status = CarStatus::Idle;
                car.direction = 0;
                if self.repositioned[car_id] || car.failure_pending {
                    return;
                }
                let home = match self.config.idle {
                    Idle::Middle => ((1 - self.config.basements + self.config.floors) as f64 / 2.0
                        + 0.5)
                        .floor() as i32,
                    Idle::High => self.config.floors,
                    Idle::Lobby => self.config.lobby,
                    Idle::Predictive => {
                        let mut frequency = HashMap::new();
                        let mut floor_order = Vec::new();
                        for p in self
                            .people
                            .iter()
                            .filter(|p| p.demand.at >= self.time - 120.0)
                        {
                            let origin = p.demand.origin;
                            let count = frequency.entry(origin).or_insert_with(|| {
                                floor_order.push(origin);
                                0
                            });
                            *count += 1;
                        }
                        floor_order
                            .into_iter()
                            .reduce(|best, floor| {
                                if frequency[&floor] > frequency[&best] {
                                    floor
                                } else {
                                    best
                                }
                            })
                            .unwrap_or(self.config.lobby)
                    }
                };
                let target = car
                    .service_floors
                    .iter()
                    .min_by_key(|&&floor| (floor - home).abs())
                    .copied()
                    .unwrap_or(car.position as i32);
                self.repositioned[car_id] = true;
                if f64::from(target) == car.position {
                    return;
                }
                target
            }
        };
        let car = &mut self.cars[car_id];
        let delta = f64::from(target) - car.position;
        if delta.abs() < 1e-8 {
            self.arrive(car_id, target);
            return;
        }
        let distance = delta.abs() * self.config.floor_height;
        let duration = travel_time(distance, car.spec.speed, car.spec.acceleration);
        let end = self.time + duration;
        car.direction = direction(delta);
        car.status = CarStatus::Moving;
        car.motion = Some(Motion {
            from: car.position,
            to: target,
            start: self.time,
            end,
            distance,
            acceleration: car.spec.acceleration,
            speed: car.spec.speed,
        });
        self.add(end, EventKind::Arrive(car_id, target));
        self.log("depart", format!("E{} → {target}층", car_id + 1));
    }

    fn arrive(&mut self, car_id: usize, target: i32) {
        let car = &mut self.cars[car_id];
        if let Some(motion) = car.motion.take() {
            car.distance += motion.distance;
            car.energy +=
                motion.distance * (600.0 + 75.0 * car.passengers.len() as f64) * 9.81 * 0.35
                    / 3_600_000.0;
        }
        car.position = target.into();
        let needed = car
            .passengers
            .iter()
            .any(|id| self.people[self.people_index[id]].next_floor() == target)
            || car
                .assigned
                .iter()
                .any(|id| self.people[self.people_index[id]].floor == target);
        if !needed {
            car.status = CarStatus::Idle;
            self.depart(car_id);
            return;
        }
        car.status = CarStatus::Opening;
        car.stops_count += 1;
        car.energy += 0.0015;
        let opens = self.time + car.spec.door_open;
        self.add(opens, EventKind::Open(car_id));
        self.log("arrive", format!("E{} {target}층 도착", car_id + 1));
    }

    fn open(&mut self, car_id: usize) {
        let car = &mut self.cars[car_id];
        car.status = CarStatus::Boarding;
        let mut handling = self.time;
        let alight_time = car.spec.alight_time;
        let leaving: Vec<_> = car
            .passengers
            .iter()
            .copied()
            .filter(|id| f64::from(self.people[self.people_index[id]].next_floor()) == car.position)
            .collect();
        for person in leaving {
            handling += alight_time;
            self.add(handling, EventKind::Alight(car_id, person));
        }
        self.add(handling, EventKind::Board(car_id, None));
    }

    fn alight(&mut self, car_id: usize, id: i64) -> Result<(), String> {
        let index = self.people_index[&id];
        let p = &mut self.people[index];
        if p.state != PassengerState::Onboard || p.car_id != Some(car_id) {
            return Ok(());
        }
        let car = &mut self.cars[car_id];
        car.passengers.retain(|&person| person != id);
        p.ride += self.time - p.boarded_at.unwrap_or(self.time);
        p.floor = car.position as i32;
        p.leg += 1;
        p.car_id = None;
        if p.floor == p.demand.destination {
            p.state = PassengerState::Complete;
            p.completed_at = Some(self.time);
            self.log("complete", format!("승객 {id} 여정 완료"));
        } else {
            p.state = PassengerState::Waiting;
            self.waiting_count += 1;
            p.queued_at = self.time;
            p.transfers += 1;
            let floor = p.floor;
            let destination = p.demand.destination;
            if self.policy == Policy::Dynamic {
                self.people[index].route = self.route(floor, destination)?;
                self.people[index].leg = 0;
            }
            self.log("transfer", format!("승객 {id} {floor}층 환승"));
        }
        self.schedule_dispatch();
        Ok(())
    }

    fn board_one(&mut self, car_id: usize, id: i64) {
        let car = &mut self.cars[car_id];
        let p = &mut self.people[self.people_index[&id]];
        if p.state == PassengerState::Waiting
            && p.car_id == Some(car_id)
            && f64::from(p.floor) == car.position
            && car.passengers.len() < car.spec.capacity
            && !car.failure_pending
        {
            p.state = PassengerState::Onboard;
            self.waiting_count -= 1;
            p.wait += self.time - p.queued_at;
            p.boarded_at = Some(self.time);
            p.first_boarded_at.get_or_insert(self.time);
            car.passengers.push(id);
            car.assigned.retain(|&person| person != id);
            self.log("board", format!("E{} 승객 {id} 탑승", car_id + 1));
        }
    }

    fn plan_boarding(&mut self, car_id: usize) {
        let car = &self.cars[car_id];
        let position = car.position;
        let mut candidates: Vec<_> = car
            .assigned
            .iter()
            .map(|id| self.people_index[id])
            .filter(|&index| {
                let p = &self.people[index];
                p.state == PassengerState::Waiting && f64::from(p.floor) == position
            })
            .collect();
        candidates.sort_by(|&a, &b| {
            let (a, b) = (&self.people[a], &self.people[b]);
            a.queued_at
                .partial_cmp(&b.queued_at)
                .unwrap_or(Ordering::Equal)
                .then_with(|| a.demand.id.cmp(&b.demand.id))
        });
        let next = car
            .passengers
            .first()
            .map(|id| self.people_index[id])
            .or_else(|| candidates.first().copied());
        let dir = next.map_or(car.direction, |index| {
            direction(f64::from(self.people[index].next_floor()) - position)
        });
        let mut space = car.spec.capacity - car.passengers.len();
        let board_time = car.spec.board_time;
        let door_close = car.spec.door_close;
        let retiring = car.failure_pending;
        let mut handling = self.time;
        self.cars[car_id].direction = dir;
        for index in candidates {
            let p = &mut self.people[index];
            let id = p.demand.id;
            if space > 0 && (p.next_floor() - p.floor).signum() == dir && !retiring {
                space -= 1;
                handling += board_time;
                self.add(handling, EventKind::Board(car_id, Some(id)));
            } else {
                p.car_id = None;
                self.cars[car_id].assigned.retain(|&person| person != id);
            }
        }
        self.cars[car_id].status = CarStatus::Boarding;
        self.add(handling, EventKind::Closing(car_id));
        self.add(handling + door_close, EventKind::Close(car_id));
    }

    pub fn inject_passengers(&mut self, records: &[Demand]) -> Result<(), String> {
        if self.finished || self.time >= self.config.duration {
            return Err("운행이 끝났어요. 처음부터 다시 시작해 주세요.".into());
        }
        let mut unique = HashSet::new();
        for record in records {
            if self.known_ids.contains(&record.id)
                || !unique.insert(record.id)
                || record.at != self.time
                || !self.floors.contains(&record.origin)
                || !self.floors.contains(&record.destination)
                || record.origin == record.destination
            {
                return Err("호출 승객의 시각·층·ID가 잘못되었습니다.".into());
            }
            self.route(record.origin, record.destination)?;
        }
        let origin_count = records
            .iter()
            .map(|record| record.origin)
            .collect::<HashSet<_>>()
            .len();
        for &record in records {
            self.known_ids.insert(record.id);
            self.demand_records.push(record);
            self.add(self.time, EventKind::Passenger(record));
        }
        self.hash = demand_hash(&self.demand_records);
        self.log(
            "call",
            format!(
                "{}명이 {origin_count}개 층에서 동시에 호출했습니다",
                records.len()
            ),
        );
        self.advance(self.time)
    }

    pub fn fail_car(&mut self, id: usize) {
        let Some(car) = self.cars.get_mut(id) else {
            return;
        };
        if car.status == CarStatus::Failed || car.failure_pending {
            return;
        }
        car.failure_pending = true;
        for p_id in std::mem::take(&mut car.assigned) {
            if let Some(&index) = self.people_index.get(&p_id)
                && self.people[index].state == PassengerState::Waiting
            {
                self.people[index].car_id = None;
            }
        }
        self.log(
            "failure",
            format!("E{} 신규 승차 중단, 탑승객 하차 후 퇴역", id + 1),
        );
        self.update_stops(id);
        if self.cars[id].status == CarStatus::Idle {
            self.depart(id);
        }
        self.schedule_dispatch();
    }

    fn process(&mut self, event: Event) -> Result<(), String> {
        self.account(event.time);
        self.time = event.time;
        self.processed += 1;
        match event.kind {
            EventKind::Passenger(demand) => {
                let route = self.route(demand.origin, demand.destination)?;
                self.people_index.insert(demand.id, self.people.len());
                self.people.push(Passenger {
                    demand,
                    state: PassengerState::Waiting,
                    floor: demand.origin,
                    route,
                    leg: 0,
                    queued_at: demand.at,
                    boarded_at: None,
                    completed_at: None,
                    car_id: None,
                    wait: 0.0,
                    ride: 0.0,
                    transfers: 0,
                    first_boarded_at: None,
                });
                self.waiting_count += 1;
                self.repositioned.fill(false);
                self.schedule_dispatch();
            }
            EventKind::Dispatch => self.dispatch(),
            EventKind::Arrive(car, target) => self.arrive(car, target),
            EventKind::Open(car) => self.open(car),
            EventKind::Alight(car, id) => self.alight(car, id)?,
            EventKind::Board(car, Some(id)) => self.board_one(car, id),
            EventKind::Board(car, None) => self.plan_boarding(car),
            EventKind::Closing(car) => self.cars[car].status = CarStatus::Closing,
            EventKind::Close(car) => {
                self.cars[car].status = CarStatus::Idle;
                self.depart(car);
                self.schedule_dispatch();
            }
            EventKind::Failure(car) => self.fail_car(car),
            EventKind::Zone => {
                self.allocate_zones(true)?;
                self.schedule_dispatch();
            }
            EventKind::Sample => {
                let metrics = self.metrics();
                self.series.push(Sample {
                    time: self.time,
                    mean_wait: metrics.mean_wait,
                    p95_wait: metrics.p95_wait,
                    queue: metrics.waiting,
                    completed: metrics.completed,
                    demand: metrics.generated,
                    positions: self.cars.iter().map(|car| car.position).collect(),
                });
            }
        }
        self.max_queue = self.max_queue.max(self.waiting_count);
        if self.processed > EVENT_LIMIT {
            return Err("Event limit exceeded".into());
        }
        Ok(())
    }

    fn drained(&self) -> bool {
        self.time >= self.config.duration
            && self.waiting_count == 0
            && self.cars.iter().all(|car| car.passengers.is_empty())
            && self.queue.peek().is_none_or(|event| event.time > self.time)
    }

    pub fn advance(&mut self, target: f64) -> Result<(), String> {
        if !target.is_finite() || target < self.time {
            return Err("Simulation time must be finite and monotonic".into());
        }
        if self.finished {
            return Ok(());
        }
        let end = target.min(self.horizon);
        while self.queue.peek().is_some_and(|event| event.time <= end) {
            if self.config.drain && self.drained() {
                self.finished = true;
                break;
            }
            let event = self.queue.pop().unwrap();
            self.process(event)?;
        }
        if !self.finished {
            self.time = end;
        }
        if self.time >= self.horizon || (self.config.drain && self.drained()) {
            self.finished = true;
        }
        Ok(())
    }

    pub fn advance_to(&mut self, target: f64) -> Result<Snapshot, String> {
        self.advance(target)?;
        Ok(self.snapshot())
    }

    pub fn step(&mut self) -> Result<Snapshot, String> {
        if !self.finished {
            if let Some(event) = self.queue.pop() {
                self.process(event)?;
                if (self.time >= self.horizon
                    && self
                        .queue
                        .peek()
                        .is_none_or(|next| next.time > self.horizon))
                    || (self.config.drain && self.drained())
                {
                    self.finished = true;
                }
            } else {
                self.time = self.horizon;
                self.finished = true;
            }
        }
        Ok(self.snapshot())
    }

    pub fn run(&mut self) -> Result<Snapshot, String> {
        self.advance_to(self.horizon)
    }

    pub fn demand_hash(&self) -> &str {
        &self.hash
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut cars = self.cars.clone();
        for car in &mut cars {
            if let Some(motion) = &car.motion {
                car.position = position_at(motion, self.time, self.config.floor_height);
            }
        }
        Snapshot {
            time: self.time,
            done: self.finished,
            algorithm: self.algorithm,
            cars,
            passengers: self.people.clone(),
            metrics: self.metrics(),
            series: self.series.clone(),
            logs: self.logs.iter().cloned().collect(),
            events: self.processed,
            demand_hash: self.hash.clone(),
        }
    }
}
