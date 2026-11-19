use super::Simulation;
use crate::{CarStatus, Metrics, Passenger, PassengerState, position_at};

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let (sum, count) = values.fold((0.0, 0), |(sum, count), value| (sum + value, count + 1));
    if count > 0 {
        sum / f64::from(count)
    } else {
        0.0
    }
}

fn quantile(sorted: &[f64], q: f64) -> f64 {
    sorted
        .get(((sorted.len() as f64 * q).ceil() as usize).saturating_sub(1))
        .copied()
        .unwrap_or(0.0)
}

fn journey(p: &Passenger) -> f64 {
    p.completed_at.unwrap() - p.demand.at
}

impl Simulation {
    pub fn run_metrics(&mut self) -> Result<Metrics, String> {
        self.advance(self.horizon)?;
        Ok(self.metrics())
    }

    pub fn metrics(&self) -> Metrics {
        let cohort: Vec<_> = self
            .people
            .iter()
            .filter(|p| p.demand.at >= self.config.warmup)
            .collect();
        let complete: Vec<_> = cohort
            .iter()
            .copied()
            .filter(|p| p.state == PassengerState::Complete)
            .collect();
        let mut waits = Vec::new();
        let mut floor_wait_totals = vec![(0.0, 0); self.floors.len()];
        for p in cohort.iter().filter(|p| p.first_boarded_at.is_some()) {
            waits.push(p.wait);
            let index = (p.demand.origin - self.floors[0]) as usize;
            let (total, count) = &mut floor_wait_totals[index];
            *total += p.wait;
            *count += 1;
        }
        waits.sort_by(f64::total_cmp);
        let floor_waits: Vec<_> = floor_wait_totals
            .into_iter()
            .map(|(total, count)| {
                if count > 0 {
                    total / f64::from(count)
                } else {
                    0.0
                }
            })
            .collect();
        let wait_by_floor = || floor_waits.iter().copied().filter(|&wait| wait > 0.0);
        let avg = mean(wait_by_floor());
        let fairness = if avg != 0.0 {
            mean(wait_by_floor().map(|wait| (wait - avg).powi(2))).sqrt() / avg
        } else {
            0.0
        };
        let mut floor_queues = vec![0; self.floors.len()];
        let mut current = Vec::with_capacity(self.waiting_count);
        let mut onboard = 0;
        let mut completed = 0;
        let mut unboarded = 0;
        for p in &self.people {
            unboarded += usize::from(p.first_boarded_at.is_none());
            match p.state {
                PassengerState::Waiting => {
                    floor_queues[(p.floor - self.floors[0]) as usize] += 1;
                    current.push(self.time - p.queued_at);
                }
                PassengerState::Onboard => onboard += 1,
                PassengerState::Complete => completed += 1,
            }
        }
        let waiting = current.len();
        let elapsed = (self.time - self.config.warmup).max(0.0);
        let throughput = if elapsed > 0.0 {
            complete.len() as f64 * 60.0 / elapsed
        } else {
            0.0
        };
        let back = self
            .series
            .iter()
            .find(|sample| sample.time >= (self.time - 60.0).max(0.0));
        let queue_growth = back
            .filter(|sample| self.time > sample.time)
            .map_or(0.0, |sample| {
                (waiting as f64 - sample.queue as f64) * 60.0 / (self.time - sample.time)
            });
        let long_wait = cohort
            .iter()
            .filter(|p| {
                let extra = if p.state == PassengerState::Waiting {
                    self.time - p.queued_at
                } else {
                    0.0
                };
                p.wait + extra > self.config.long_wait
            })
            .count();
        let distance = self.cars.iter().fold(0.0, |sum, car| {
            let partial = car.motion.as_ref().map_or(0.0, |m| {
                (position_at(m, self.time, self.config.floor_height) - m.from).abs()
                    * self.config.floor_height
            });
            sum + car.distance + partial
        });
        let stops = self.cars.iter().map(|car| car.stops_count).sum::<usize>();
        let dt = self.time - self.last_account;
        let ratio = |numerator: usize, denominator: usize| {
            if denominator > 0 {
                numerator as f64 / denominator as f64
            } else {
                0.0
            }
        };
        Metrics {
            generated: self.people.len(),
            waiting,
            onboard,
            completed,
            unboarded,
            unfinished: waiting + onboard,
            mean_wait: mean(waits.iter().copied()),
            median_wait: quantile(&waits, 0.5),
            p95_wait: quantile(&waits, 0.95),
            p99_wait: quantile(&waits, 0.99),
            max_wait: waits.last().copied().unwrap_or(0.0),
            mean_ride: mean(complete.iter().map(|p| p.ride)),
            mean_journey: mean(complete.iter().copied().map(journey)),
            throughput,
            throughput5: throughput * 5.0,
            current_mean_wait: mean(current.iter().copied()),
            oldest_wait: current.into_iter().fold(0.0, f64::max),
            max_queue: self.max_queue,
            distance,
            energy: self.cars.iter().map(|car| car.energy).sum(),
            stops,
            stops_per_passenger: ratio(stops, complete.len()),
            fairness,
            long_wait_ratio: ratio(long_wait, cohort.len()),
            transferred: complete.iter().filter(|p| p.transfers > 0).count(),
            direct_mean_journey: mean(
                complete
                    .iter()
                    .copied()
                    .filter(|p| p.transfers == 0)
                    .map(journey),
            ),
            transfer_mean_journey: mean(
                complete
                    .iter()
                    .copied()
                    .filter(|p| p.transfers > 0)
                    .map(journey),
            ),
            floor_queues,
            floor_waits,
            utilization: self
                .cars
                .iter()
                .map(|car| {
                    if self.time == 0.0 {
                        return 0.0;
                    }
                    let extra = if matches!(car.status, CarStatus::Idle | CarStatus::Failed) {
                        0.0
                    } else {
                        dt
                    };
                    (car.busy_time + extra) / self.time
                })
                .collect(),
            occupancy: self
                .cars
                .iter()
                .map(|car| {
                    if self.time == 0.0 {
                        return 0.0;
                    }
                    (car.load_integral + dt * car.passengers.len() as f64)
                        / self.time
                        / car.spec.capacity as f64
                })
                .collect(),
            wait_samples: waits,
            queue_growth,
            supply_margin: if cohort.is_empty() {
                0.0
            } else {
                ratio(complete.len(), cohort.len()) - 1.0
            },
        }
    }
}
