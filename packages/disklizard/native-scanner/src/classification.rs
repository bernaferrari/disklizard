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
            | "build.ninja"
            | "intermediates"
            | "outputs"
            | "libs"
            | "bin"
            | "obj"
    )
}

/// Sibling names that establish a genuine project root for a candidate's
/// parent directory. Name-only evidence, like everything in this module: the
/// scanner never reads project file contents. A manifest beside a
/// conventional artifact basename corroborates both identity and a reinstall
/// path, which is what promotes a discovery-only match to reviewed-batch
/// eligibility.
pub(crate) fn is_project_marker_name(name: &str) -> bool {
    matches!(
        name,
        "package.json"
            | "package-lock.json"
            | "npm-shrinkwrap.json"
            | "yarn.lock"
            | "pnpm-lock.yaml"
            | "bun.lockb"
            | "bun.lock"
            | "bower.json"
            | "pyproject.toml"
            | "requirements.txt"
            | "setup.py"
            | "setup.cfg"
            | "pipfile"
            | "poetry.lock"
            | "uv.lock"
            | "go.mod"
            | "go.sum"
            | "cargo.toml"
            | "cargo.lock"
            | "pom.xml"
            | "build.gradle"
            | "build.gradle.kts"
            | "settings.gradle"
            | "settings.gradle.kts"
            | "cmakelists.txt"
            | "pubspec.yaml"
            | "pubspec.lock"
    )
}

const NODE_MARKERS: &[&str] = &[
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "bun.lock",
    "bower.json",
];
const PYTHON_MARKERS: &[&str] = &[
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "setup.cfg",
    "pipfile",
    "poetry.lock",
    "uv.lock",
];
const GO_MARKERS: &[&str] = &["go.mod", "go.sum"];
const RUST_MARKERS: &[&str] = &["cargo.toml", "cargo.lock"];
const JVM_MARKERS: &[&str] = &[
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
];
const CPP_MARKERS: &[&str] = &["cmakelists.txt"];
const DART_MARKERS: &[&str] = &["pubspec.yaml", "pubspec.lock"];

/// Matching markers in sorted order, mirroring the TypeScript fallback so the
/// emitted `parent:` evidence strings are byte-identical.
fn ecosystem_markers(markers: &[String], accepted: &[&str]) -> Vec<String> {
    let mut matched: Vec<String> = markers
        .iter()
        .map(|marker| marker.to_lowercase())
        .filter(|marker| accepted.contains(&marker.as_str()))
        .collect();
    matched.sort();
    matched.dedup();
    matched
}

fn evidence(name: &str, signatures: &[String], parent_markers: &[String]) -> Vec<String> {
    let mut evidence = Vec::with_capacity(signatures.len() + parent_markers.len() + 1);
    evidence.push(format!("name:{name}"));
    evidence.extend(
        signatures
            .iter()
            .map(|signature| format!("contains:{signature}")),
    );
    evidence.extend(
        parent_markers
            .iter()
            .map(|marker| format!("parent:{marker}")),
    );
    evidence
}

fn verified(
    kind: DeveloperArtifactKind,
    ecosystem: DeveloperArtifactEcosystem,
    name: &str,
    signatures: &[String],
    parent_markers: &[String],
) -> DeveloperArtifactClassification {
    DeveloperArtifactClassification {
        kind,
        ecosystem,
        confidence: DeveloperArtifactConfidence::Verified,
        cleanup: DeveloperArtifactCleanupReadiness::Eligible,
        evidence: evidence(name, signatures, parent_markers),
    }
}

fn likely(
    kind: DeveloperArtifactKind,
    ecosystem: DeveloperArtifactEcosystem,
    name: &str,
    signatures: &[String],
    parent_markers: &[String],
) -> DeveloperArtifactClassification {
    DeveloperArtifactClassification {
        kind,
        ecosystem,
        confidence: DeveloperArtifactConfidence::Likely,
        // Likely recognition is useful context but not sufficient evidence
        // for Smart Cleanup to preselect a destructive action.
        cleanup: DeveloperArtifactCleanupReadiness::Review,
        evidence: evidence(name, signatures, parent_markers),
    }
}

fn review(kind: DeveloperArtifactKind, name: &str) -> DeveloperArtifactClassification {
    DeveloperArtifactClassification {
        kind,
        ecosystem: DeveloperArtifactEcosystem::Generic,
        confidence: DeveloperArtifactConfidence::Ambiguous,
        cleanup: DeveloperArtifactCleanupReadiness::Review,
        evidence: evidence(name, &[], &[]),
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
    parent_markers: &[String],
) -> Option<DeveloperArtifactClassification> {
    let name = raw_name.to_lowercase();
    let parent_name = raw_parent_name.map(str::to_lowercase);
    let node_markers = ecosystem_markers(parent_markers, NODE_MARKERS);
    let python_markers = ecosystem_markers(parent_markers, PYTHON_MARKERS);
    let go_markers = ecosystem_markers(parent_markers, GO_MARKERS);
    let rust_markers = ecosystem_markers(parent_markers, RUST_MARKERS);
    let jvm_markers = ecosystem_markers(parent_markers, JVM_MARKERS);
    let cpp_markers = ecosystem_markers(parent_markers, CPP_MARKERS);
    let dart_markers = ecosystem_markers(parent_markers, DART_MARKERS);
    match name.as_str() {
        // Basename-only matches stay `likely`: a conventional name justifies
        // discovery, never verified disposability. `verified` requires
        // corroborating context — direct toolchain signatures below, or a
        // parent basename that makes a generic name specific.
        "node_modules" => {
            if node_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::Dependencies,
                    DeveloperArtifactEcosystem::Node,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::Dependencies,
                    DeveloperArtifactEcosystem::Node,
                    &name,
                    &[],
                    &node_markers,
                ))
            }
        }
        "bower_components" | "jspm_packages" => {
            if node_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::Dependencies,
                    DeveloperArtifactEcosystem::Web,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::Dependencies,
                    DeveloperArtifactEcosystem::Web,
                    &name,
                    &[],
                    &node_markers,
                ))
            }
        }
        ".pnpm-store" | ".npm" | ".turbo" | ".parcel-cache" | ".rollup.cache" => {
            if node_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Node,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Node,
                    &name,
                    &[],
                    &node_markers,
                ))
            }
        }
        "__pycache__" | ".mypy_cache" | ".pytest_cache" | ".ruff_cache" | ".tox" => {
            if python_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Python,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Python,
                    &name,
                    &[],
                    &python_markers,
                ))
            }
        }
        ".venv" | "venv" => {
            if python_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::Dependencies,
                    DeveloperArtifactEcosystem::Python,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::Dependencies,
                    DeveloperArtifactEcosystem::Python,
                    &name,
                    &[],
                    &python_markers,
                ))
            }
        }
        ".next" | ".nuxt" | ".output" | ".svelte-kit" | ".astro" => {
            if node_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Node,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Node,
                    &name,
                    &[],
                    &node_markers,
                ))
            }
        }
        "deriveddata" => Some(likely(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Apple,
            &name,
            &[],
            &[],
        )),
        ".dart_tool" | ".pub-cache" => {
            if dart_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Dart,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Dart,
                    &name,
                    &[],
                    &dart_markers,
                ))
            }
        }
        "gocache" => {
            if go_markers.is_empty() {
                Some(likely(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Go,
                    &name,
                    &[],
                    &[],
                ))
            } else {
                Some(verified(
                    DeveloperArtifactKind::ToolchainCache,
                    DeveloperArtifactEcosystem::Go,
                    &name,
                    &[],
                    &go_markers,
                ))
            }
        }
        "target" => {
            let rust = matching_signatures(signatures, &[".rustc_info.json", "debug", "release"]);
            if rust.iter().any(|signature| signature == ".rustc_info.json") {
                return Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Rust,
                    &name,
                    &rust,
                    &rust_markers,
                ));
            }
            if !rust.is_empty() && !rust_markers.is_empty() {
                return Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Rust,
                    &name,
                    &rust,
                    &rust_markers,
                ));
            }
            if !rust.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Rust,
                    &name,
                    &rust,
                    &[],
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
            if !jvm.is_empty() && !jvm_markers.is_empty() {
                return Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Jvm,
                    &name,
                    &jvm,
                    &jvm_markers,
                ));
            }
            if !jvm.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Jvm,
                    &name,
                    &jvm,
                    &[],
                ));
            }
            Some(review(DeveloperArtifactKind::BuildOutput, &name))
        }
        "build" => {
            let cmake =
                matching_signatures(signatures, &["cmakecache.txt", "cmakefiles", "build.ninja"]);
            if !cmake.is_empty() {
                return Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Cpp,
                    &name,
                    &cmake,
                    &cpp_markers,
                ));
            }
            let jvm =
                matching_signatures(signatures, &["classes", "intermediates", "outputs", "libs"]);
            if !jvm.is_empty() && !jvm_markers.is_empty() {
                return Some(verified(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Jvm,
                    &name,
                    &jvm,
                    &jvm_markers,
                ));
            }
            if !jvm.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Jvm,
                    &name,
                    &jvm,
                    &[],
                ));
            }
            let dotnet = matching_signatures(signatures, &["bin", "obj"]);
            if !dotnet.is_empty() {
                return Some(likely(
                    DeveloperArtifactKind::BuildOutput,
                    DeveloperArtifactEcosystem::Dotnet,
                    &name,
                    &dotnet,
                    &[],
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
            &[],
        )),
        // Identity is not recoverability: a Maven local repository also
        // holds locally built and manually installed artifacts that no
        // remote can re-download, so it stays review-only without
        // provenance detail.
        "repository" if parent_name.as_deref() == Some(".m2") => Some(likely(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Jvm,
            &name,
            &[],
            &[],
        )),
        "registry" | "git" if parent_name.as_deref() == Some(".cargo") => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Rust,
            &name,
            &[],
            &[],
        )),
        "packages" if parent_name.as_deref() == Some(".nuget") => Some(verified(
            DeveloperArtifactKind::ToolchainCache,
            DeveloperArtifactEcosystem::Dotnet,
            &name,
            &[],
            &[],
        )),
        "mod" if parent_name.as_deref() == Some("pkg") => Some(likely(
            DeveloperArtifactKind::Dependencies,
            DeveloperArtifactEcosystem::Go,
            &name,
            &[],
            &[],
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_conventional_basename_alone_never_verifies_disposability() {
        for name in [
            ".output",
            "deriveddata",
            "gocache",
            "node_modules",
            "__pycache__",
            ".next",
        ] {
            let classification = classify(name, Some("project"), &[], &[]).unwrap();
            assert!(
                matches!(
                    classification.confidence,
                    DeveloperArtifactConfidence::Likely
                ),
                "{name} should stay likely from its name alone"
            );
            assert!(
                matches!(
                    classification.cleanup,
                    DeveloperArtifactCleanupReadiness::Review
                ),
                "{name} should stay review-gated from its name alone"
            );
        }
    }

    #[test]
    fn corroborating_context_promotes_to_verified_eligible() {
        let rust = classify(
            "target",
            Some("project"),
            &[".rustc_info.json".into(), "debug".into()],
            &[],
        )
        .unwrap();
        assert!(matches!(
            rust.confidence,
            DeveloperArtifactConfidence::Verified
        ));
        assert!(matches!(
            rust.cleanup,
            DeveloperArtifactCleanupReadiness::Eligible
        ));

        let gradle = classify("caches", Some(".gradle"), &[], &[]).unwrap();
        assert!(matches!(
            gradle.confidence,
            DeveloperArtifactConfidence::Verified
        ));
        assert!(matches!(
            gradle.cleanup,
            DeveloperArtifactCleanupReadiness::Eligible
        ));
    }
    #[derive(Debug, serde::Deserialize)]
    struct CorpusExpectation {
        kind: String,
        ecosystem: String,
        confidence: String,
        cleanup: String,
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CorpusCase {
        name: String,
        parent: String,
        #[serde(default)]
        signatures: Vec<String>,
        #[serde(default)]
        parent_markers: Vec<String>,
        expected: Option<CorpusExpectation>,
    }

    #[derive(Debug, serde::Deserialize)]
    struct Corpus {
        cases: Vec<CorpusCase>,
    }

    #[test]
    fn matches_the_shared_classification_corpus() {
        // The same JSON drives the TypeScript fallback's conformance test;
        // a case that passes here and fails there (or vice versa) is policy
        // drift between the two scanners.
        let corpus: Corpus =
            serde_json::from_str(include_str!("../../src/classification-corpus.json")).unwrap();
        assert!(corpus.cases.len() >= 20);
        for case in &corpus.cases {
            let actual = classify(
                &case.name,
                Some(&case.parent),
                &case.signatures,
                &case.parent_markers,
            );
            match (&case.expected, &actual) {
                (None, None) => {}
                (Some(expected), Some(actual)) => {
                    assert_eq!(
                        format!("{:?}", actual.kind).to_lowercase().replace('-', ""),
                        expected.kind.replace('-', ""),
                        "{:?} kind",
                        case.name
                    );
                    assert_eq!(
                        format!("{:?}", actual.ecosystem)
                            .to_lowercase()
                            .replace('-', ""),
                        expected.ecosystem.replace('-', ""),
                        "{:?} ecosystem",
                        case.name
                    );
                    assert_eq!(
                        format!("{:?}", actual.confidence)
                            .to_lowercase()
                            .replace('-', ""),
                        expected.confidence.replace('-', ""),
                        "{:?} confidence",
                        case.name
                    );
                    assert_eq!(
                        format!("{:?}", actual.cleanup)
                            .to_lowercase()
                            .replace('-', ""),
                        expected.cleanup.replace('-', ""),
                        "{:?} cleanup",
                        case.name
                    );
                }
                _ => panic!(
                    "{:?} classified as {:?}, expected {:?}",
                    case.name, actual, case.expected
                ),
            }
        }
    }
}
