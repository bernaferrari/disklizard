//! Conservative developer-artifact classification.
//!
//! Keeping this policy out of the traversal engine makes it possible to audit
//! changes to cleanup eligibility without having to reason about filesystem
//! recursion, inventory retention, or platform metadata at the same time.

use super::{
    DeveloperArtifactClassification, DeveloperArtifactCleanupReadiness,
    DeveloperArtifactConfidence, DeveloperArtifactEcosystem, DeveloperArtifactKind,
};

pub(crate) fn is_evidence_name(name: &str) -> bool {
    matches!(
        name,
        ".rustc_info.json"
            | "debug"
            | "release"
            | "classes"
            | "test-classes"
            | "generated-sources"
            | "surefire-reports"
            | "cmakecache.txt"
            | "cmakefiles"
            | "intermediates"
            | "outputs"
            | "libs"
            | "bin"
            | "obj"
    )
}

fn evidence(name: &str, signatures: &[String]) -> Vec<String> {
    let mut evidence = Vec::with_capacity(signatures.len() + 1);
    evidence.push(format!("name:{name}"));
    evidence.extend(
        signatures
            .iter()
            .map(|signature| format!("contains:{signature}")),
    );
    evidence
}

fn verified(
    kind: DeveloperArtifactKind,
    ecosystem: DeveloperArtifactEcosystem,
    name: &str,
    signatures: &[String],
) -> DeveloperArtifactClassification {
    DeveloperArtifactClassification {
        kind,
        ecosystem,
        confidence: DeveloperArtifactConfidence::Verified,
        cleanup: DeveloperArtifactCleanupReadiness::Eligible,
        evidence: evidence(name, signatures),
    }
}

fn likely(
    kind: DeveloperArtifactKind,
    ecosystem: DeveloperArtifactEcosystem,
    name: &str,
    signatures: &[String],
) -> DeveloperArtifactClassification {
    DeveloperArtifactClassification {
        kind,
        ecosystem,
        confidence: DeveloperArtifactConfidence::Likely,
        // Likely recognition is useful context but not sufficient evidence
        // for Smart Cleanup to preselect a destructive action.
        cleanup: DeveloperArtifactCleanupReadiness::Review,
        evidence: evidence(name, signatures),
    }
}

fn review(kind: DeveloperArtifactKind, name: &str) -> DeveloperArtifactClassification {
    DeveloperArtifactClassification {
        kind,
        ecosystem: DeveloperArtifactEcosystem::Generic,
        confidence: DeveloperArtifactConfidence::Ambiguous,
        cleanup: DeveloperArtifactCleanupReadiness::Review,
        evidence: evidence(name, &[]),
    }
}

fn matching_signatures(signatures: &[String], accepted: &[&str]) -> Vec<String> {
    signatures
        .iter()
        .filter(|signature| accepted.contains(&signature.as_str()))
        .cloned()
        .collect()
}

/// Match the TypeScript fallback's intentionally conservative inventory rules.
/// A familiar generic basename remains review-only until direct entries prove
/// a conventional toolchain layout.
pub(crate) fn classify(
    raw_name: &str,
    raw_parent_name: Option<&str>,
    signatures: &[String],
) -> Option<DeveloperArtifactClassification> {
    let name = raw_name.to_lowercase();
    let parent_name = raw_parent_name.map(str::to_lowercase);
    match name.as_str() {
        "node_modules" => Some(verified(
            DeveloperArtifactKind::Dependencies,
            DeveloperArtifactEcosystem::Node,
            &name,
            &[],
        )),
        "bower_components" | "jspm_packages" => Some(likely(
            DeveloperArtifactKind::Dependencies,
            DeveloperArtifactEcosystem::Web,
            &name,
            &[],
        )),
        ".pnpm-store" | ".npm" | ".turbo" | ".parcel-cache" | ".rollup.cache" => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Node,
            &name,
            &[],
        )),
        "__pycache__" | ".mypy_cache" | ".pytest_cache" | ".ruff_cache" | ".tox" => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Python,
            &name,
            &[],
        )),
        ".venv" | "venv" => Some(likely(
            DeveloperArtifactKind::Dependencies,
            DeveloperArtifactEcosystem::Python,
            &name,
            &[],
        )),
        ".next" | ".nuxt" | ".output" | ".svelte-kit" | ".astro" => Some(verified(
            DeveloperArtifactKind::BuildOutput,
            DeveloperArtifactEcosystem::Node,
            &name,
            &[],
        )),
        "deriveddata" => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Apple,
            &name,
            &[],
        )),
        ".dart_tool" | ".pub-cache" => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Dart,
            &name,
            &[],
        )),
        "gocache" => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Go,
            &name,
            &[],
        )),
        "target" => {
            let rust = matching_signatures(signatures, &[".rustc_info.json", "debug", "release"]);
            if rust.iter().any(|signature| signature == ".rustc_info.json") {
                return Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Rust,
                    &name,
                    &rust,
                ));
            }
            if !rust.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Rust,
                    &name,
                    &rust,
                ));
            }
            let jvm = matching_signatures(
                signatures,
                &[
                    "classes",
                    "test-classes",
                    "generated-sources",
                    "surefire-reports",
                ],
            );
            if !jvm.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Jvm,
                    &name,
                    &jvm,
                ));
            }
            Some(review(DeveloperArtifactKind::BuildOutput, &name))
        }
        "build" => {
            let cmake = matching_signatures(signatures, &["cmakecache.txt", "cmakefiles"]);
            if !cmake.is_empty() {
                return Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Cpp,
                    &name,
                    &cmake,
                ));
            }
            let jvm =
                matching_signatures(signatures, &["classes", "intermediates", "outputs", "libs"]);
            if !jvm.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Jvm,
                    &name,
                    &jvm,
                ));
            }
            let dotnet = matching_signatures(signatures, &["bin", "obj"]);
            if !dotnet.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Dotnet,
                    &name,
                    &dotnet,
                ));
            }
            Some(review(DeveloperArtifactKind::BuildOutput, &name))
        }
        "dist" | "out" => Some(review(DeveloperArtifactKind::BuildOutput, &name)),
        "caches" if parent_name.as_deref() == Some(".gradle") => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Jvm,
            &name,
            &[],
        )),
        "repository" if parent_name.as_deref() == Some(".m2") => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Jvm,
            &name,
            &[],
        )),
        "registry" | "git" if parent_name.as_deref() == Some(".cargo") => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Rust,
            &name,
            &[],
        )),
        "packages" if parent_name.as_deref() == Some(".nuget") => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Dotnet,
            &name,
            &[],
        )),
        "mod" if parent_name.as_deref() == Some("pkg") => Some(likely(
            DeveloperArtifactKind::Dependencies,
            DeveloperArtifactEcosystem::Go,
            &name,
            &[],
        )),
        _ => None,
    }
}
