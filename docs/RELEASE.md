# Release evidence — November 4, 2026

PR #11 was merged into `ux/round-8`, which is now the default branch. The repository is public; unauthenticated Git access and the Apache-2.0 license endpoint returned successfully. Project source uses Apache-2.0, while Plus Jakarta Sans retains SIL. Package `private: true` prevents accidental npm publication; it does not mean the GitHub repository is private.

The functional release at `a537168b75e6e745db406d827dad5a72282b5e0c` passed all 504 tests, typecheck and production build locally, on the target server, and in Linux/Windows CI. The merge commit is `9ba86f6fbfebe7c505f45e722345ed62aae3f64e`. This release includes isolated expiring demos, quantity-change impact reviews, stale-sheet guards, the guide, local fonts and verified SQLite recovery.

The deployed runtime uses that tested functional release, behind the existing tailnet HTTPS endpoint. The old backend and private database remain available for rollback. Verified backups preceded both updates. The original private workspace matched its backup after cutover; unrelated proxy settings were unchanged.

Live HTTPS checks covered visitor start, named approval, case clarification, a partial substitute offer with a larger total shortage, explicit buyer consent, shortage notices, a late reduction, named cut decision, stale-sheet refusal, reconfirmation, packing and day export. The partial-offer rehearsal exposed and fixed wording that confused the offered amount with the whole shortage; optional model drafting now uses draft-v3. Its new wording has not been evaluated through fresh live-model calls.

A local video draft uses edited screens from the real workflow, recorded Meta responses, synthetic data and synthetic narration, with captions. It is under three minutes. A local file is not a public submission video URL; owner review and public hosting remain outstanding.

Independent coordinator sessions, a fresh model comparison and measured user outcomes remain outstanding. No time-savings, delivery or food-rescue result is claimed. The interactive URL is tailnet-only; public judge access has not been demonstrated. This is a hackathon prototype, not an authenticated customer service. Reboot persistence and off-host retention remain operational work.
