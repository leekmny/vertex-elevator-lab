use vertex_core::{AlgorithmId, Config, Demand, Simulation, generate_demand, manual_calls};

#[test]
fn hand_calculated_single_trip_preserves_physical_and_passenger_state() {
    let config = Config {
        cars: 1,
        floors: 5,
        duration: 30.0,
        ..Config::default()
    };
    let demand = vec![Demand {
        id: 1,
        at: 0.0,
        origin: 1,
        destination: 2,
    }];
    let result = Simulation::new(config, AlgorithmId::Fcfs, Some(demand))
        .unwrap()
        .run()
        .unwrap();
    assert!(result.done);
    assert_eq!(result.metrics.generated, 1);
    assert_eq!(result.metrics.completed, 1);
    assert!((result.metrics.mean_wait - 2.3).abs() < 1e-10);
    assert!(
        (result.metrics.mean_journey - (2.3 + 1.5 + 2.0 * 3.5_f64.sqrt() + 1.5 + 0.6)).abs()
            < 1e-10
    );
}

#[test]
fn manual_calls_are_deterministic_atomic_and_match_the_event_queue() {
    let config = Config::default();
    let demand = generate_demand(&config).unwrap();
    assert_eq!(demand, generate_demand(&config).unwrap());
    let mut sim = Simulation::new(config.clone(), AlgorithmId::Eta, Some(Vec::new())).unwrap();
    let calls = manual_calls(&config, 0.0, &[1, 3, 3], 2, 0).unwrap();
    assert_eq!(
        calls.iter().map(|d| d.id).collect::<Vec<_>>(),
        [-1, -2, -3, -4]
    );
    sim.inject_passengers(&calls).unwrap();
    let before = sim.snapshot();
    assert_eq!(before.metrics.generated, 4);
    assert!(sim.inject_passengers(&calls).is_err());
    assert_eq!(sim.snapshot(), before);
}
