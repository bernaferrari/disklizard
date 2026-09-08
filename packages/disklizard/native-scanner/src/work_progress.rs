use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

// A directory owns a share of traversal work, divided among its children as
// they are discovered. File sizes and APFS block ownership never enter it.
const TOTAL: u64 = 1 << 60;
pub struct Work {
    completed: Arc<AtomicU64>,
    units: u64,
}
impl Work {
    pub fn root(completed: Arc<AtomicU64>) -> Self {
        Self {
            completed,
            units: TOTAL,
        }
    }
    #[cfg(test)]
    pub fn split(self, count: usize) -> Vec<Self> {
        self.split_weights(&vec![1; count])
    }
    pub fn split_weights(mut self, weights: &[u64]) -> Vec<Self> {
        let total: u64 = weights.iter().sum();
        if total == 0 {
            // Retain the parent's budget until this directory has finished.
            return Vec::new();
        }
        let mut assigned = 0;
        let mut cumulative = 0;
        let children = weights.iter().map(|weight| {
            cumulative += weight;
            let end = (self.units as u128 * cumulative as u128 / total as u128) as u64;
            let units = end - assigned;
            assigned = end;
            Self { completed: self.completed.clone(), units }
        }).collect();
        self.units = 0;
        children
    }
    pub fn percent(completed: &AtomicU64) -> f64 {
        completed.load(Ordering::Relaxed) as f64 / TOTAL as f64 * 100.0
    }
}
impl Drop for Work {
    fn drop(&mut self) {
        self.completed.fetch_add(self.units, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_files_do_not_complete_unvisited_directories() {
        let count = Arc::new(AtomicU64::new(0));
        let mut children = Work::root(count.clone()).split(2);
        drop(children.pop()); // Even a multi-terabyte file only completes its own work.
        assert_eq!(Work::percent(&count), 50.0);
        let mut nested = children.pop().unwrap().split(100);
        drop(nested.drain(..50));
        assert!((Work::percent(&count) - 75.0).abs() < 0.01);
        drop(nested);
        assert_eq!(Work::percent(&count), 100.0);
    }
    #[test]
    fn skipped_entries_do_not_advance_traversal() {
        let count = Arc::new(AtomicU64::new(0));
        let mut children = Work::root(count.clone()).split_weights(&[0, 0, 0, 1, 1]);
        drop(children.drain(..3));
        assert_eq!(Work::percent(&count), 0.0);
        drop(children.pop());
        assert_eq!(Work::percent(&count), 50.0);
        drop(children);
        assert_eq!(Work::percent(&count), 100.0);
    }
    #[test]
    fn unreadable_empty_and_skipped_entries_complete_their_share() {
        let count = Arc::new(AtomicU64::new(0));
        drop(Work::root(count.clone()).split(3));
        assert_eq!(Work::percent(&count), 100.0);
    }
}
