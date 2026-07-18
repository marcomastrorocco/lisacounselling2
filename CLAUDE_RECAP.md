# Claude review recap — Addenda 01 and 02

Date: 19 July 2026  
Preview: https://lisa-counselling.vercel.app/

## Scope executed

- Applied Addendum 02 as the final authority for credential wording.
- Retained Addendum 01 requirements for imagery, the temporary portrait treatment, self-hosting, responsive behaviour and pre-launch indexing protection.
- Made no changes to Move-and-Groove 2 or any other project.

## Credential and content changes

- The single credential wording used sitewide is **ACA Registered Counsellor**.
- Updated the Home metadata, trust bar and About teaser.
- Rebuilt the About page with the above-the-fold credential band: **Master of Counselling · ACA Registered Counsellor**.
- Replaced the About body with the supplied hook, professional background, bicultural-practice and closing copy.
- Rendered only the two confirmed qualification items. The unconfirmed university, graduation year and further training are retained as HTML comments and are not presented to visitors.
- Preserved the full approved My Approach lists, including all seven practice foundations and all seven possible therapeutic techniques.

## Imagery and performance

- Added exactly four decorative photographic placements: Home texture band, How I Can Help foliage band, My Approach room-detail inset, and Contact texture inset.
- Added no photograph to the Domestic & Family Violence page.
- Added restrained sage portrait placeholders to the Home teaser and About header. These use the existing leaf mark until Lisa's approved portrait is supplied.
- Every photograph is self-hosted, lazy-loaded, has explicit dimensions and uses an optimised WebP with a JPEG fallback.
- Each production image file is below 150 KB. Source and licence details are recorded in `assets/img/CREDITS.md`.

## Privacy and pre-launch protection

- Added the explicit `noindex, nofollow` guard to all seven page heads.
- The guard is clearly marked for removal at launch.
- The contact page still contains no personal telephone number.

## Responsive implementation

- Photograph bands change from 21:9 on larger screens to 16:9 on smaller screens.
- About, portrait, approach and contact layouts collapse to a single column on narrow screens.
- The About portrait moves above the text on mobile; the approach image also stacks above its copy.
- Existing responsive navigation, cards, buttons, form fields and footer behaviour remain in place.

## Items Lisa must confirm before launch

1. University name and Master of Counselling graduation year.
2. Exact wording for any additional qualifications or professional training, copied from certificates; otherwise omit those lines.
3. Approved professional portrait.
4. Practice email, Halaxy booking URL, contact-form endpoint, ABN and final privacy-policy text.
5. Remove the seven pre-launch indexing guards and allow indexing only after all content is approved.

## Recommended Claude checks

1. Verify the About page against Addendum 02 line by line.
2. Confirm that credential wording is consistent across visible copy and metadata.
3. Confirm there are exactly four photographic content placements and none on the specialist family-violence page.
4. Confirm the unresolved qualification details are not visible to visitors.
5. Review responsive layouts at approximately 390 px, 768 px and 1440 px.
6. Confirm all temporary must-supply placeholders are resolved before public launch.
