use crate::types::{
    AnalysisContext, CommandExecution, CommandStatus, GateFinding, GateReport, GateStatus,
    LLMOutput, Priority, RequirementStatus, RiskLevel, TestMindConfig,
};

fn strict_mode(config: &TestMindConfig) -> bool {
    config.strict.unwrap_or(false)
}

fn escalate(current: GateStatus, next: GateStatus) -> GateStatus {
    if next.order() < current.order() {
        next
    } else {
        current
    }
}

pub fn evaluate_gate(
    ctx: &AnalysisContext,
    llm_result: &LLMOutput,
    command_results: &[CommandExecution],
    config: &TestMindConfig,
) -> GateReport {
    let mut status = GateStatus::Pass;
    let mut findings: Vec<GateFinding> = Vec::new();
    let strict = strict_mode(config);

    let failed_commands: Vec<_> = command_results
        .iter()
        .filter(|r| r.status == CommandStatus::Failed)
        .collect();
    if !failed_commands.is_empty() {
        status = GateStatus::Fail;
        findings.push(GateFinding {
            status: GateStatus::Fail,
            summary: format!("{} 个验证命令执行失败", failed_commands.len()),
        });
    }

    let critical_count = llm_result
        .checklist
        .iter()
        .filter(|item| item.priority == Priority::Critical)
        .count();
    if critical_count > 0 {
        status = GateStatus::Fail;
        findings.push(GateFinding {
            status: GateStatus::Fail,
            summary: format!("存在 {} 个 critical 风险检查项未验证", critical_count),
        });
    }

    let high_count = llm_result
        .checklist
        .iter()
        .filter(|item| item.priority == Priority::High)
        .count();
    if high_count > 0 {
        let finding_status = if strict {
            GateStatus::Fail
        } else {
            GateStatus::Warn
        };
        status = escalate(status, finding_status.clone());
        findings.push(GateFinding {
            status: finding_status,
            summary: format!("存在 {} 个 high 风险检查项，需要重点验证", high_count),
        });
    }

    if !ctx.requirements.is_empty() {
        let missing_requirements: Vec<_> = llm_result
            .requirement_coverage
            .iter()
            .filter(|item| item.status == RequirementStatus::Missing)
            .collect();
        if !missing_requirements.is_empty() && config.fail_on_missing_requirements.unwrap_or(true) {
            status = GateStatus::Fail;
            findings.push(GateFinding {
                status: GateStatus::Fail,
                summary: format!("有 {} 条需求未被实现覆盖", missing_requirements.len()),
            });
        }

        let partial_or_unclear: Vec<_> = llm_result
            .requirement_coverage
            .iter()
            .filter(|item| {
                matches!(
                    item.status,
                    RequirementStatus::Partial | RequirementStatus::Unclear
                )
            })
            .collect();
        if !partial_or_unclear.is_empty() {
            let finding_status = if strict {
                GateStatus::Fail
            } else {
                GateStatus::Warn
            };
            status = escalate(status, finding_status.clone());
            findings.push(GateFinding {
                status: finding_status,
                summary: format!(
                    "有 {} 条需求仅部分覆盖或证据不清晰",
                    partial_or_unclear.len()
                ),
            });
        }

        if llm_result.requirement_coverage.len() < ctx.requirements.len() {
            let finding_status = if strict {
                GateStatus::Fail
            } else {
                GateStatus::Warn
            };
            status = escalate(status, finding_status.clone());
            findings.push(GateFinding {
                status: finding_status,
                summary: format!(
                    "需求映射不完整: 输入 {} 条，输出仅覆盖 {} 条",
                    ctx.requirements.len(),
                    llm_result.requirement_coverage.len()
                ),
            });
        }
    }

    let uncovered_high_risk = ctx
        .test_coverage
        .uncovered
        .iter()
        .filter(|path| {
            ctx.history.hotspots.iter().any(|h| {
                h.path == **path && matches!(h.risk_level, RiskLevel::High | RiskLevel::Medium)
            })
        })
        .count();
    if uncovered_high_risk > 0 && config.fail_on_uncovered_high_risk.unwrap_or(true) {
        status = GateStatus::Fail;
        findings.push(GateFinding {
            status: GateStatus::Fail,
            summary: format!(
                "有 {} 个中高风险变更文件没有找到对应测试",
                uncovered_high_risk
            ),
        });
    }

    if let Some(min_ratio) = config.min_coverage_ratio {
        if !ctx.test_coverage.covered.is_empty() || !ctx.test_coverage.uncovered.is_empty() {
            if ctx.test_coverage.coverage_ratio < min_ratio {
                let finding_status = if strict {
                    GateStatus::Fail
                } else {
                    GateStatus::Warn
                };
                status = escalate(status, finding_status.clone());
                findings.push(GateFinding {
                    status: finding_status,
                    summary: format!(
                        "测试覆盖率 {:.0}% 低于要求的 {:.0}%",
                        ctx.test_coverage.coverage_ratio * 100.0,
                        min_ratio * 100.0
                    ),
                });
            }
        }
    }

    if !ctx.stage_warnings.is_empty() {
        let finding_status = if config.fail_on_stage_warnings.unwrap_or(false) || strict {
            GateStatus::Fail
        } else {
            GateStatus::Warn
        };
        status = escalate(status, finding_status.clone());
        findings.push(GateFinding {
            status: finding_status,
            summary: format!("分析阶段存在 {} 条数据完整性警告", ctx.stage_warnings.len()),
        });
    }

    if status == GateStatus::Pass && llm_result.risk_level == RiskLevel::High {
        status = GateStatus::Warn;
        findings.push(GateFinding {
            status: GateStatus::Warn,
            summary: "LLM 总体风险判定为 HIGH，建议人工复核".to_string(),
        });
    }

    if findings.is_empty() {
        findings.push(GateFinding {
            status: GateStatus::Pass,
            summary: "未发现阻塞性问题，当前变更满足已配置的验收门槛".to_string(),
        });
    }

    GateReport { status, findings }
}

#[cfg(test)]
mod tests {
    use crate::types::{
        AnalysisContext, CheckItem, CommandExecution, CommandStatus, DependencyAnalysis,
        GateStatus, GitAnalysis, GitStats, HistoryAnalysis, LLMOutput, Priority,
        RequirementCoverage, RequirementItem, RequirementStatus, RiskLevel, TestCoverage,
        TestMindConfig, VerificationMethod,
    };

    use super::evaluate_gate;

    fn base_context() -> AnalysisContext {
        AnalysisContext {
            git: GitAnalysis {
                base_branch: "main".to_string(),
                head_branch: "feature".to_string(),
                changed_files: Vec::new(),
                stats: GitStats {
                    additions: 10,
                    deletions: 2,
                    files_changed: 1,
                },
                commits: Vec::new(),
            },
            dependencies: DependencyAnalysis {
                impacted_files: Vec::new(),
                shared_modules: Vec::new(),
                entry_points: Vec::new(),
            },
            history: HistoryAnalysis {
                hotspots: Vec::new(),
                recent_fix_commits: Vec::new(),
            },
            test_coverage: TestCoverage {
                covered: Vec::new(),
                uncovered: Vec::new(),
                related_tests: Vec::new(),
                coverage_ratio: 1.0,
            },
            requirements: vec![RequirementItem {
                id: "REQ-001".to_string(),
                text: "User can save the draft".to_string(),
            }],
            knowledge_matches: Vec::new(),
            stage_warnings: Vec::new(),
        }
    }

    fn base_llm() -> LLMOutput {
        LLMOutput {
            summary: "ok".to_string(),
            risk_level: RiskLevel::Low,
            checklist: Vec::new(),
            test_suggestions: Vec::new(),
            requirement_coverage: vec![RequirementCoverage {
                id: "REQ-001".to_string(),
                requirement: "User can save the draft".to_string(),
                status: RequirementStatus::Covered,
                evidence: "Save path updated".to_string(),
                related_files: vec!["src/save.rs".to_string()],
            }],
            warnings: Vec::new(),
        }
    }

    #[test]
    fn fails_on_missing_requirement() {
        let ctx = base_context();
        let mut llm = base_llm();
        llm.requirement_coverage[0].status = RequirementStatus::Missing;

        let report = evaluate_gate(&ctx, &llm, &[], &TestMindConfig::default());
        assert_eq!(report.status, GateStatus::Fail);
    }

    #[test]
    fn fails_on_critical_item() {
        let ctx = base_context();
        let mut llm = base_llm();
        llm.checklist.push(CheckItem {
            id: "CHK-001".to_string(),
            priority: Priority::Critical,
            category: "API契约".to_string(),
            title: "critical".to_string(),
            description: "desc".to_string(),
            related_files: vec!["src/api.rs".to_string()],
            verification_method: VerificationMethod::ApiTest,
        });

        let report = evaluate_gate(&ctx, &llm, &[], &TestMindConfig::default());
        assert_eq!(report.status, GateStatus::Fail);
    }

    #[test]
    fn fails_on_command_failure() {
        let ctx = base_context();
        let llm = base_llm();
        let commands = vec![CommandExecution {
            command: "cargo test".to_string(),
            status: CommandStatus::Failed,
            exit_code: Some(101),
            stdout: String::new(),
            stderr: "boom".to_string(),
        }];

        let report = evaluate_gate(&ctx, &llm, &commands, &TestMindConfig::default());
        assert_eq!(report.status, GateStatus::Fail);
    }
}
