# Security policy

DiskLizard scans and can move user data to the operating system Trash or Recycle Bin, so we treat path handling, identity validation, privilege boundaries, and release artifacts as security-sensitive.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use [GitHub's private vulnerability-reporting form](https://github.com/bernaferrari/disklizard/security/advisories/new) and include:

- DiskLizard version, operating system, and filesystem;
- a minimal reproduction or proof of concept;
- the affected path shape without private filenames where possible; and
- potential impact, especially whether it can cause unintended deletion, privilege escalation, data exposure, or an update-channel compromise.

We will acknowledge reports within seven days, work with the reporter on a fix and credit, then publish an advisory after a fix or mitigation is available.

## Supported versions

Before the first packaged release, only the current `main` branch is supported. Packaged releases will publish their supported version range and artifact checksums in the release notes.

## Safe testing

Never test deletion behavior against irreplaceable data. Use a temporary directory or disposable volume. The TUI is read-only; desktop cleanup must use the review → revalidate → Trash/Recycle Bin flow.
