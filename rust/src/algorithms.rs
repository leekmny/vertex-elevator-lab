use crate::input::{Rng, direction, travel_time};
use crate::{AlgorithmId, CarState, CarStatus, Config};

pub(crate) struct HallCall {
    pub origin: i32,
    pub direction: i32,
    pub queued_at: f64,
    pub destination: Option<i32>,
}

pub(crate) fn score_car(
    id: AlgorithmId,
    car: &CarState,
    call: &HallCall,
    time: f64,
    c: &Config,
) -> f64 {
    let origin = f64::from(call.origin);
    let distance = (car.position - origin).abs();
    let start = car
        .motion
        .map_or(car.position, |motion| f64::from(motion.to));
    let remaining = car
        .motion
        .map_or(0.0, |motion| (motion.end - time).max(0.0));
    let spec = &car.spec;
    let handling = spec.door_open + spec.door_close + spec.board_time;
    let pending = car.stops.iter().filter(|&&floor| floor != call.origin);
    let arrival = remaining
        + travel_time(
            (start - origin).abs() * c.floor_height,
            spec.speed,
            spec.acceleration,
        )
        + pending.clone().count() as f64 * handling
        + pending
            .map(|&floor| ((f64::from(floor) - start).abs() * c.floor_height / spec.speed) * 0.2)
            .sum::<f64>()
        + if car.status == CarStatus::Boarding {
            handling
        } else {
            0.0
        };
    let along = car.direction == 0
        || (car.direction == call.direction && direction(origin - car.position) == car.direction);
    let direction_penalty = if along { 0.0 } else { f64::from(c.floors) };
    let load =
        (car.passengers.len() as f64 + car.assigned.len() as f64 * 0.5) / spec.capacity as f64;
    let age = (time - call.queued_at).max(0.0);
    let edge = if call.direction > 0 {
        c.floors
    } else {
        1 - c.basements
    };
    let inferred = (f64::from((edge - call.origin).abs()) * c.floor_height / spec.speed) * 0.5;
    match id {
        AlgorithmId::Fcfs => car.assigned.len() as f64 * 1000.0 + arrival,
        AlgorithmId::Nearest => distance,
        AlgorithmId::Direction => distance + direction_penalty,
        AlgorithmId::Collective => {
            distance + direction_penalty * 2.0 + car.assigned.len() as f64 * 0.3
        }
        AlgorithmId::Look | AlgorithmId::Scan => arrival + direction_penalty * 2.0,
        AlgorithmId::Journey => arrival + inferred * (1.0 + load * 0.3),
        AlgorithmId::Destination => {
            let stop_saving = if call.destination.is_some_and(|f| car.stops.contains(&f)) {
                8.0
            } else {
                0.0
            };
            arrival
                + f64::from((call.destination.unwrap_or(call.origin) - call.origin).abs())
                    * c.floor_height
                    / spec.speed
                - stop_saving
                + load * 5.0
        }
        AlgorithmId::Multi | AlgorithmId::Genetic | AlgorithmId::Annealing => {
            c.weights.wait * arrival
                + c.weights.journey * (arrival + inferred)
                + (c.weights.fairness * arrival * age) / c.long_wait.max(1.0)
                + c.weights.energy * distance * c.floor_height
                + c.weights.balance * load * 30.0
        }
        _ => arrival + load * 3.0,
    }
}

pub(crate) fn optimize_assignments(
    id: AlgorithmId,
    calls: &[HallCall],
    eligible: &[Vec<usize>],
    cars: &[CarState],
    now: f64,
    config: &Config,
    random: &mut Rng,
) -> Vec<usize> {
    let count = calls.len();
    let scores: Vec<Vec<_>> = calls
        .iter()
        .zip(eligible)
        .map(|(call, options)| {
            options
                .iter()
                .map(|&car| score_car(AlgorithmId::Multi, &cars[car], call, now, config))
                .collect()
        })
        .collect();
    let initial: Vec<_> = scores
        .iter()
        .map(|options| {
            (1..options.len()).fold(0, |best, index| {
                if options[index] < options[best] {
                    index
                } else {
                    best
                }
            })
        })
        .collect();
    let objective = |genes: &[usize]| {
        let mut assignments = [0; 20];
        let mut cost = 0.0;
        for (i, &gene) in genes.iter().enumerate() {
            let car = eligible[i][gene];
            cost += scores[i][gene] + f64::from(assignments[car]) * 8.0;
            assignments[car] += 1;
        }
        cost
    };
    let mutate = |genes: &[usize], random: &mut Rng| {
        let mut mutated = genes.to_vec();
        let k = random.index(count);
        mutated[k] = random.index(eligible[k].len());
        mutated
    };
    let mut best = initial.clone();
    let mut best_cost = objective(&best);
    if id == AlgorithmId::Annealing {
        let mut current = initial;
        let mut current_cost = best_cost;
        for k in 0..64 {
            let next = mutate(&current, random);
            let cost = objective(&next);
            let temp = 20.0 * libm::pow(0.94, f64::from(k));
            if cost < current_cost || random.next() < libm::exp((current_cost - cost) / temp) {
                current = next;
                current_cost = cost;
            }
            if current_cost < best_cost {
                best.clone_from(&current);
                best_cost = current_cost;
            }
        }
    } else {
        let mut population = vec![initial];
        population.extend((0..11).map(|_| {
            eligible
                .iter()
                .map(|options| random.index(options.len()))
                .collect()
        }));
        for _ in 0..8 {
            population.sort_by(|a, b| {
                objective(a)
                    .partial_cmp(&objective(b))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let cost = objective(&population[0]);
            if cost < best_cost {
                best.clone_from(&population[0]);
                best_cost = cost;
            }
            let mut next = population[..3].to_vec();
            while next.len() < 12 {
                let a = &population[random.index(6)];
                let b = &population[random.index(6)];
                let cut = random.index(count);
                let mut child = Vec::with_capacity(count);
                child.extend_from_slice(&a[..cut]);
                child.extend_from_slice(&b[cut..]);
                if random.next() < 0.65 {
                    child = mutate(&child, random);
                }
                next.push(child);
            }
            population = next;
        }
    }
    best.into_iter()
        .enumerate()
        .map(|(i, gene)| eligible[i][gene])
        .collect()
}
