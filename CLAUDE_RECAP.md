# Lisa Chiarini Counselling Website — Claude Review Recap

## Review objective

Vet the current production website for copy accuracy, professional claims, counselling-sector appropriateness, accessibility, privacy, technical correctness, and consistency with the approved Lisa Chiarini brief.

Production: https://lisa-counselling.vercel.app/

Repository: https://github.com/marcomastrorocco/LisaCounselling

## Changes made in this revision

### Credential wording

- Removed every instance of the previous ACA membership-level wording.
- Replaced it with the owner-approved wording “M.A.C.A registered Counsellor”.
- Updated the homepage trust bar, homepage About teaser, homepage meta description, About page opening copy, and About page meta description.
- A case-insensitive repository search should return no remaining numeric ACA membership-level credential references.

### My Approach page

- Replaced the opening paragraph with the owner-supplied wording about each person bringing a unique story, strengths, and way of understanding the world.
- Added a structured “My practice is grounded in” list containing:
  - Trauma-informed care
  - Person-centred therapy
  - Attachment-informed practice
  - Strengths-based and recovery-oriented practice
  - Culturally responsive care
  - Evidence-based therapeutic approaches
  - Somatically informed practice
- Added a structured “Depending on your needs, therapy may incorporate” list containing:
  - Cognitive Behavioural Therapy (CBT)
  - Acceptance and Commitment Therapy (ACT)
  - Solution-Focused Therapy (SFBT)
  - Motivational Interviewing (MI)
  - Mindfulness and grounding strategies
  - Psychoeducation
  - Attachment-informed interventions
- Added the owner-supplied closing principle: counselling should be collaborative, respectful, and tailored to what is most meaningful for the client.
- Retained the existing “What to expect” and practical-details content below the revised approach material.
- Added semantic unordered lists and visible list markers for accessibility and scanning.

## Existing site state Claude should vet

- Seven static routes: Home, About, How I Can Help, My Approach, Domestic & Family Violence, Contact, and Privacy.
- Shared sticky navigation and two-band footer.
- Crisis-support information appears on every page.
- Main content is centred; long lists remain left-aligned for readability.
- The approved July 2026 logo is used on the homepage.
- Lisa’s personal phone number has been removed from visible content and structured metadata.
- The Contact page includes an enquiry form and a warning not to submit urgent or highly sensitive health information.

## Unresolved launch placeholders

These are intentionally unresolved and must be supplied before a public launch using the final domain:

- `{{HALAXY_URL}}`
- `{{PRACTICE_EMAIL}}`
- `{{CONTACT_FORM_ENDPOINT}}`
- `{{PRIVACY_COPY}}`
- `{{ABN}}`

The contact form is not operational until `{{CONTACT_FORM_ENDPOINT}}` is replaced with an approved form-processing endpoint. Claude should not treat the visible form as proof that enquiries are currently delivered.

## Requested Claude vetting checklist

1. Confirm “M.A.C.A registered Counsellor” is the exact preferred professional styling and punctuation for Lisa’s membership status.
2. Check whether “Solution-Focused Therapy (SFBT)” should instead be styled “Solution-Focused Brief Therapy (SFBT)” based on Lisa’s qualification and intended claim.
3. Check every modality and professional claim against Lisa’s actual training, competence, registration, and insurance scope.
4. Review domestic and family violence content for trauma-informed, non-blaming, non-promissory language and appropriate crisis boundaries.
5. Confirm the site does not imply emergency monitoring, guaranteed outcomes, or medical/psychological registration beyond Lisa’s actual credentials.
6. Check heading hierarchy, link labels, keyboard use, form labels, contrast, and mobile reading order against WCAG 2.1 AA.
7. Review the contact-form data flow before activation, including consent language, retention, spam handling, and Australian Privacy Principles obligations.
8. Require legally reviewed final privacy copy before launch; do not approve the current placeholders as a privacy policy.
9. Verify final Halaxy, email, ABN, canonical-domain, and Open Graph values before launch.
10. Search for Windows-1252/UTF-8 mojibake and corrupted smart punctuation before approving deployment.

## Files changed in this revision

- `index.html`
- `about/index.html`
- `approach/index.html`
- `styles.css`
- `CLAUDE_RECAP.md`
