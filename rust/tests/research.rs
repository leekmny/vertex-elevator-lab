use vertex_core::{AlgorithmId, Config, ExperimentPlan, ResearchSession};

fn plan() -> ExperimentPlan {
    ExperimentPlan {
        floor_values: vec![5],
        car_values: vec![2, 1],
        congestion_values: vec![100],
        algorithms: vec![AlgorithmId::Look, AlgorithmId::Eta],
        seeds: vec![11, 12],
        target_wait: 120.0,
        metric: "meanWait".into(),
    }
}

#[test]
fn keeps_seed_pairs_and_counts_completed_trials_in_fleet_order() {
    let config = Config {
        duration: 40.0,
        rate: 10.0,
        drain: true,
        ..Config::default()
    };
    let mut session = ResearchSession::new(config, plan()).unwrap();
    let mut completed = 0;
    while let Some(progress) = session.step().unwrap() {
        completed += 1;
        assert_eq!(progress.completed, completed);
        assert_eq!(progress.total, 8);
    }
    let result = session.finish(false).unwrap();
    assert!(!result.cancelled);
    assert_eq!(result.rows.len(), 4);
    assert_eq!(result.rows[0].cars, 1);
    assert_eq!(result.rows[0].wait.n, 2);
    for (a, b) in result.rows[0].runs.iter().zip(&result.rows[1].runs) {
        assert_eq!(a.demand_hash, b.demand_hash);
        assert_eq!(
            a.metrics.generated,
            a.metrics.waiting + a.metrics.onboard + a.metrics.completed
        );
    }
}

#[test]
fn cancelling_between_runs_preserves_single_observation_with_unbounded_interval() {
    let config = Config {
        duration: 20.0,
        rate: 0.0,
        ..Config::default()
    };
    let mut session = ResearchSession::new(config, plan()).unwrap();
    session.step().unwrap();
    let result = session.finish(true).unwrap();
    assert!(result.cancelled);
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].runs.len(), 1);
    assert_eq!(result.rows[0].wait.high, f64::INFINITY);
}
