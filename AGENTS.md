# Project environment

- Project files are synchronized to the `deepvirtual` host through Watchman.
- `deepvirtual` is the runtime host with the NVIDIA RTX 3090 GPU. Do not infer
  deployment GPU capacity from the GPU installed on the local development host.
- SSH access to `deepvirtual` is authorized for project-related inspection,
  deployment, and verification whenever needed.

# README maintenance

Before every commit:

1. Review the staged changes for user-facing behavior, configuration,
   dependencies, setup steps, API endpoints, and operational changes.
2. Update `README.md` when those changes affect its accuracy or leave an
   important feature undocumented.
3. If no README update is needed, explicitly confirm that it was reviewed.
4. Run `git diff --check` before committing.

# Commit messages

- Use plain, descriptive commit subjects.
- Do not use Conventional Commit-style prefixes such as `feat:`, `fix:`, or
  `merge:`.
- Include a detailed commit body for substantive changes; one sentence is not
  enough for a major feature.
- Explain what changed, the user or operational benefit, and important
  implementation details or safeguards.
- Separate the subject from the body with a blank line and use paragraph
  breaks where they improve readability.
- Hard-wrap every commit-message line at 75 characters or fewer.
