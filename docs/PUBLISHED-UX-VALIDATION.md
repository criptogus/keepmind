# Published UX validation — 2026-11-13

## Confirmed defect and fix

Corp deliberately has no project continuity service, but Today requested it and offered project navigation. The resulting unsupported-service error was presented as a temporary loading failure. Today now receives the edition capability from App, skips that request, removes unsupported project actions and explains where to resume context in Corp. SB retains its project cards and navigation.

Regression coverage: a component test checks no unsupported request/error/project action and preserved source/chat navigation. The existing experience-smoke batch now tests the App-to-Today capability wiring and full source opening in Corp at 1024×640. No new runner was introduced.

## Actual validation

- `TMPDIR=/private/tmp npm test`: 297 passed, 2 existing skips (50 files passed, 1 skipped).
- `npm run typecheck`, `npm run build`, `npm run corp:build-brain`: passed. Existing dynamic-import and large-chunk warnings remain.
- `npm run test:experience`: 12 passed; zero browser errors. Synthetic renderer coverage includes project continuation, source navigation, draft/error/retry, reduced motion, compact navigation/focus and onboarding layouts. Report/screenshots: `artifacts/experience-smoke/`.
- `git diff --check`: passed.

## Published app attempt and limits

The macOS 0.2.6 DMGs were rehashed against GitHub asset digests and copied into disposable `/private/tmp` folders. SB commit: `769a150bc0f46c2b1d23ca022b1fd815ed61e431`; Corp commit: `e006ef2522007312567220d777b2a25912bc0a03`.

Each process used an explicit temporary user-data directory and an outer sandbox denying home writes, reads of user Application Support/Documents, and non-local network access. No production profile, installation or credentials were used. SB backend fixture creation and Corp local login/capture succeeded. SB reported a visible native window, but the computer-use tool could not resolve either running application. Corp exited before browser inspection. Consequently, no native visual journey, native animation/fluidity, real AI generation or installed-app performance is marked passed.

The sandbox blocked OS Keychain. For synthetic SB fixture preparation only, the process used the existing in-memory SecretStore implementation; vault encryption remained active. This is not a Keychain/security validation and changes no product code.

Synthetic renderer screenshots were inspected, but cannot substitute for a native test. Native published-app acceptance remains pending. This PR fixes the independently reproduced capability defect; it does not claim release acceptance.

## Corp product direction recorded

User preference: deploy Corp once to the company's server or VPS, expose one shared URL, and let the team join the same organization/workspace. Initial organization/admin setup, verified corporate email, invitation acceptance and roles need an explicit onboarding flow. Matching an email domain alone must not grant workspace access. The current per-desktop local server and technical owner bootstrap do not provide that experience. Deployment/authentication changes are not implemented by this UI correction.
