// limits.rs — WannaCut Plan Limits
//
// Public file — open-core model.
// Defines what each plan can do. Add new features here as they are built.
// None = unlimited.

// ─────────────────────────────────────────────
// STRUCTS
// ─────────────────────────────────────────────

pub struct PlanLimits {
    pub vocal_remover_daily: Option<u32>, // None = unlimited
}

// ─────────────────────────────────────────────
// PLAN DEFINITIONS
// ─────────────────────────────────────────────

pub const FREE_LIMITS: PlanLimits = PlanLimits {
    vocal_remover_daily: Some(5),
};

pub const PRO_LIMITS: PlanLimits = PlanLimits {
    vocal_remover_daily: Some(10),
};

pub const ULTIMATE_LIMITS: PlanLimits = PlanLimits {
    vocal_remover_daily: None,
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

use crate::plans::Plan;

pub fn limits_for(plan: &Plan) -> &'static PlanLimits {
    match plan {
        Plan::Free     => &FREE_LIMITS,
        Plan::Pro      => &PRO_LIMITS,
        Plan::Ultimate => &ULTIMATE_LIMITS,
    }
}
