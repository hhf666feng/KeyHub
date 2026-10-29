//! Current-screen zoom geometry for the custom borderless macOS window.
//!
//! Tauri/Tao's borderless maximize fallback uses `NSScreen::mainScreen`, which
//! moves a window to the primary display. This module only computes the target
//! and restore frames in logical coordinates; the caller reads/writes the native
//! window after choosing the work area of the display that currently contains it.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Frame {
    pub fn right(self) -> f64 {
        self.x + self.width
    }

    pub fn bottom(self) -> f64 {
        self.y + self.height
    }

    pub fn is_finite(self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
    }

    pub fn approximately_equals(self, other: Self) -> bool {
        nearly_same(self, other)
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ZoomState {
    pub restore: Option<Frame>,
    pub expanded: Option<Frame>,
}

const MATCH_TOLERANCE: f64 = 1.0;
const DEFAULT_WIDTH: f64 = 1200.0;
const DEFAULT_HEIGHT: f64 = 800.0;

fn nearly_same(left: Frame, right: Frame) -> bool {
    (left.x - right.x).abs() <= MATCH_TOLERANCE
        && (left.y - right.y).abs() <= MATCH_TOLERANCE
        && (left.width - right.width).abs() <= MATCH_TOLERANCE
        && (left.height - right.height).abs() <= MATCH_TOLERANCE
}

fn centered_default(work: Frame) -> Frame {
    let width = DEFAULT_WIDTH.min(work.width);
    let height = DEFAULT_HEIGHT.min(work.height);
    Frame {
        x: work.x + ((work.width - width) / 2.0).max(0.0),
        y: work.y + ((work.height - height) / 2.0).max(0.0),
        width,
        height,
    }
}

// Keep the titlebar reachable, without moving an ordinary restore frame simply
// because its lower edge previously overlapped the Dock/work-area boundary.
fn fit_to_work(frame: Frame, work: Frame) -> Frame {
    let intersects = frame.x < work.right()
        && frame.right() > work.x
        && frame.y < work.bottom()
        && frame.bottom() > work.y;
    if !frame.is_finite() || !intersects {
        return work;
    }
    let width = frame.width.min(work.width);
    let height = frame.height.min(work.height);
    Frame {
        x: frame.x.clamp(
            work.x + 32.0_f64.min(width) - width,
            work.right() - 32.0_f64.min(width),
        ),
        y: frame.y.clamp(work.y, work.bottom() - 40.0_f64.min(height)),
        width,
        height,
    }
}

impl ZoomState {
    /// Returns the next frame and state for a titlebar double click or Maximize
    /// press. `current` and `work` are logical, top-left-origin frames.
    pub fn next(mut self, current: Frame, work: Frame) -> (Frame, Self) {
        if !work.is_finite() {
            return (current, self);
        }
        if let Some(expanded) = self.expanded {
            if nearly_same(expanded, current) {
                let target = self
                    .restore
                    .map(|restore| fit_to_work(restore, work))
                    .unwrap_or_else(|| centered_default(work));
                return (target, Self::default());
            }
            // The user moved or resized while expanded: treat that as the new
            // normal frame instead of restoring stale geometry.
            self.restore = Some(if current.is_finite() { current } else { work });
        } else if nearly_same(current, work) {
            // Native maximize may have happened before this module saw a normal
            // frame; there is no exact frame to restore, so use a safe default.
            return (centered_default(work), Self::default());
        } else {
            self.restore = Some(current);
        }
        (
            work,
            Self {
                restore: self.restore,
                expanded: Some(work),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(x: f64, y: f64, width: f64, height: f64) -> Frame {
        Frame {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn zoom_targets_current_work_area_and_restores_exact_frame() {
        let current = frame(-1760., -420., 1200., 800.);
        let external = frame(-1920., -591., 1920., 1055.);
        let mut state = ZoomState::default();
        let (target, next) = state.next(current, external);
        assert_eq!(target, external);
        state = next;
        let (target, next) = state.next(external, external);
        assert_eq!(target, current);
        assert!(next.restore.is_none());
    }

    #[test]
    fn manual_resize_does_not_restore_stale_geometry() {
        let work = frame(0., 38., 1512., 944.);
        let (_, state) = ZoomState::default().next(frame(150., 110., 1200., 800.), work);
        let manually_moved = frame(-1800., -400., 1100., 750.);
        let other_work = frame(-1920., -591., 1920., 1055.);
        let (target, state) = state.next(manually_moved, other_work);
        assert_eq!(target, other_work);
        assert_eq!(state.next(other_work, other_work).0, manually_moved);
    }

    #[test]
    fn detached_or_resized_screen_keeps_restored_frame_reachable() {
        let old = frame(-1760., -420., 1200., 800.);
        let new_work = frame(0., 38., 1000., 700.);
        let state = ZoomState {
            restore: Some(old),
            expanded: Some(new_work),
        };
        assert_eq!(state.next(new_work, new_work).0, new_work);
    }

    #[test]
    fn fractional_retina_geometry_and_native_maximized_start_can_restore() {
        let work = frame(0., 38., 1512., 944.);
        let current = frame(150.5, 111.5, 1200., 800.);
        let (_, state) = ZoomState::default().next(current, work);
        let rounded = frame(0.5, 38.5, 1511.5, 943.5);
        assert_eq!(state.next(rounded, work).0, current);
        let (restore, _) = ZoomState::default().next(work, work);
        assert_eq!((restore.width, restore.height), (1200., 800.));
        assert!(restore.x >= work.x && restore.y >= work.y);
    }

    #[test]
    fn restore_keeps_original_bounds_when_titlebar_remains_reachable() {
        let work = frame(0., 38., 1512., 852.);
        let original = frame(149., 111., 1200., 800.);
        let (_, zoomed) = ZoomState::default().next(original, work);
        assert_eq!(zoomed.next(work, work).0, original);
    }
}
