# ZIP lesson uploads

The active `index.html` imports `lesson-package.js`. Alternate HTML copies in
the repository are not the GitHub Pages entry point.

## Storage and access

ZIPs are checked, extracted and converted to a self-contained HTML package in
the administrator's browser. The manifest contains the actual asset bytes,
not temporary object URLs. At playback, the sandboxed lesson creates fresh
object URLs and resolves its HTML, CSS and JavaScript asset references.

The resulting HTML is uploaded to the existing private `course-lessons`
Supabase bucket. The `lessons.storage_path` column points to a new immutable
object for each upload. Existing HTML records, course IDs, authentication,
course access codes and the `course-gateway` API contract are preserved.
Students still request an authorized signed URL through the existing gateway.
No public asset bucket, service-role key or new database column is introduced.

Replacements retain the previous object for recovery. If a database response
is lost, staged files are retained as well: a lost response must not trigger
deletion of a file that a committed lesson record may already reference.
Old/staged objects may therefore require administrator-reviewed cleanup later.

## Package requirements

- Put one `index.html` at the root, or inside a single lesson folder. A unique
  shallowest index is preferred; otherwise a unique shallowest HTML is used.
- HTML/HTM, JPG/JPEG, PNG, SVG, GIF, WebP, MP3, MP4, OGG, WAV, WebM, CSS,
  JS/MJS, JSON, TXT, VTT, WOFF/WOFF2, TTF and ICO are accepted.
- Use relative static asset paths. CSS URLs/imports, HTML resource attributes
  and literal JavaScript asset URLs/imports are resolved inside the package.
- Computed JavaScript URLs, circular module/page dependencies, service workers,
  import maps, application servers and `<base href>` are not supported. These
  need a hosted lesson or a build that produces a static lesson first.
- At most 500 content files, 14 MiB extracted, 20 MiB input and 20 MiB prepared
  HTML. Supabase can impose a lower bucket/project limit. These limits are
  checked before uploading; videos are not silently omitted or transcoded.
  Compress large videos or use an externally hosted HTTPS video URL.
- Invalid/truncated archives, checksum failures, encrypted/multi-disk/ZIP64
  archives, symbolic links, traversal/absolute paths, unsafe filenames and
  duplicate/case-ambiguous paths are rejected. No archive path is written to
  the filesystem or used as a Supabase storage key.

## Supabase verification boundary

The repository contains frontend integration only, not the deployed Edge
Function source, SQL policies or bucket configuration. The public catalog API
responded successfully during this change. Bucket metadata is not available
with the frontend publishable key; no admin credentials were supplied.

A real authenticated upload and student access test is still required to
verify the deployed policies and gateway. An administrator must confirm:

1. `course-lessons` stays private, accepts `text/html` and permits the desired
   prepared size (up to 20 MiB within the project's plan limit).
2. Storage INSERT and lesson INSERT/UPDATE/SELECT policies permit authenticated
   administrators and deny unauthorized users. Do not relax policies publicly.
3. `course-gateway` validates course access/published status and signs the
   record's `storage_path` rather than constructing the old filename from its ID.

Use an authenticated administrator session or Supabase dashboard access for
these checks. Never place a service-role key in this repository or frontend.

## Validation performed

Chromium tests used a real ZIP with a nested `index.html`, image assets, local
MP3/MP4, imported CSS and JavaScript modules. Sandboxed rendering, interaction,
asset resolution and reopening the saved HTML in an independent browser
context were exercised. Invalid archive, traversal, duplicate filename,
missing HTML, ambiguous entry point, missing asset and extraction-size failures
were tested. Plain HTML passes through unchanged.

The actual admin form was tested against a simulated Supabase client: ZIP save,
reopen, interaction, a denied database replacement, successful HTML replacement,
new storage path persistence and retention of old content all passed. This is
not a claim that a production Supabase upload or student authorization test was
completed. The original iframe sandbox restrictions were preserved.

Backup: `backups/index-before-zip-20261026.html` (original active entry point).
ZIP decoder: vendored fflate 0.8.2, with its MIT license in `vendor/`.

## Review on 27 October 2026

The live Pages entry point already contained HTML/ZIP support when this review
started. Its successful deployment was commit `aa57a01c64e2978b89282134ea623dd9f9a883ab`.
This follow-up preserves that implementation and loads the ZIP decoder on demand
so an unavailable ZIP module cannot stop login or plain HTML uploads. The form
now reports the selected filename/size, rejects invalid or oversized selections
immediately, and displays upload version `20261027` for deployment identification.

Before this follow-up, the exact active index and renderer were backed up under
`backups/*before*review*20261027*` in commit `81253d28fa5310a293a14fb6efffb2123f520085`.
No existing lesson record or storage object was changed by this review.

Current checks: JavaScript syntax check and 13 Node checks passed (HTML byte
preservation; corrupt ZIP; traversal; absolute path; unsupported extension;
missing/ambiguous HTML; case collisions; extraction limit; HTML without ZIP
module; actionable module-load failure; input size; invalid upload extension).
The live welcome page rendered, its served module contained both upload formats,
and the public catalog gateway returned HTTP 200. Authenticated production
upload, student playback, media decoding and cross-device reopening have NOT
been verified during this follow-up. They require an administrator login and a
test course access code; bucket/policy changes require Supabase project access.
