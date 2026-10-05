## Release notes

Write GitHub Release notes for users, not as a commit transcript. Keep the automatically generated change list as supporting detail. Lead with the release stage, intended audience, and the behavior now available, then use only the sections that contain useful information:

1. Highlights: group user-visible capabilities by task and state the result, not the implementation history.
2. Install or update: show the exact GitHub installer command, supported targets, and any explicit pre-release version requirement.
3. Fixes: describe the trigger and resulting behavior; omit internal refactors with no user effect.
4. Known limitations: retain Beta/RC instability, platform boundaries, data or cost caveats, and unavailable workflows.
5. Verification and security: summarize target coverage, checksums, attestations, clean-install/update evidence, and relevant privacy boundaries without pasting full logs.
6. Feedback and comparison: link Issues and the full version comparison when a previous public version exists.

Generate computable facts from the version manifest, release-set, checksums, workflow results, repository identity, and previous public tag. Do not manually type versions, targets, hashes, asset lists, or comparison URLs into an operating sequence. The primary TypeScript release entry must create or validate those fields and stop on disagreement. Human editing is limited to release purpose, user impact, grouping, and known limitations that require judgment. Claims must describe the exact tagged source and its completed acceptance; label planned or unverified behavior explicitly. Keep GitHub Release notes as the version owner and do not create a duplicate hand-maintained changelog.

GitHub exposes one Markdown body for each Release rather than localized Release variants. Wombat Release notes use English as the single canonical body. Do not create language-specific tags or duplicate Releases. Generate and validate the English body through the primary TypeScript entry, and keep stable identifiers, versions, hashes, commands, and asset names unchanged.
