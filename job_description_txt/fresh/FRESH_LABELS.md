# Fresh evaluation set: pre-labelled (frozen before any run)

Labelled by the developer (single labeller) from the ads and `rules.ts`, before pasting any ad into JobCompass.
Second read-through by Claude against the same rules; disagreements are listed under each row's note.

## Labelling rules (fixed before running)
- Profile: subclass 500, currently in study term, more than 6 months remaining, 0 years experience.
- Verdict reflects visa / work-rights / eligibility clauses only. Seniority, years of experience and
  full-time are non-binding heads-ups and must NOT change the verdict.
- A clause counts only if the ad states it as a requirement or an explicit welcome. "Preferred",
  "desirable", neutral application questions (e.g. "which statement best describes your right to work")
  do not count.
- Labels are not changed after seeing app output. Disputed ads are marked "ambiguous" and the label below stands.
- Score on verdict only (APPLY / TAILOR / SKIP). Report per class, not only overall.

## Main set (20 ads, scored)

| # | Ad | Label | Deciding sentence / reason | Trap / note |
|---|----|-------|----------------------------|-------------|
| 1 | DingGo, Junior Software Developer | APPLY | No visa clause | "Full-time office attendance" during onboarding is not an employment type |
| 2 | Healthcare startup, Backend Engineer (Spring Boot) | APPLY | No visa clause | Wants senior; heads-up only |
| 3 | Tyree Transformers, Junior Software Engineer | APPLY | No visa clause | "Full-time opportunity" is a promo bullet, not "permanent full-time" |
| 4 | Linksea Furniture, Software Developer | APPLY | No visa clause | "At least one year" experience is not a verdict rule |
| 5 | Embedded Software Engineer, Junior/Mid (IoT) | APPLY | No visa clause | Seek-style "right to work" question only |
| 6 | Impact Curriculum, Software Engineer | APPLY | No visa clause | WWCC / police check are not clearance or registration; right-to-work question is neutral |
| 7 | SEEK, Software Engineering Graduate | SKIP | "must have full and unrestricted working rights" | Expected rule: T1_FULL_WORK_RIGHTS_STUDENT_500 |
| 8 | WK Pathways (law) | SKIP | "Australian citizen or permanent resident with unrestricted working rights" | Citizen/PR and work rights in one clause |
| 9 | Mallesons Insight Program | SKIP | "must hold Australian or New Zealand citizenship or Australian permanent residency" | |
| 10 | Hall & Wilcox First Nations Pathway | SKIP | "be a permanent resident of Australia" | |
| 11 | Randstad, Temporary Admin Assistant | TAILOR | "Working Holiday Visas (WHV) Welcome!" | Ambiguous: WHV-only, also says "Full working rights required". T2_TEMPORARY_VISA_ALLOWED is checked first |
| 12 | NSW Ambulance, Recruitment Officer | TAILOR | "temporary visa holders is only considered if no suitable permanent resident or citizen is identified" | Trap: citizenship/PR extraction from the same sentence |
| 13 | Cloud 9 Window Cleaning | TAILOR | "Working Holiday Visa Holders Welcome" | Same pattern as #11 (counts as WHV pattern, n=2); also "full Australian working rights" |
| 14 | Property Inspectors, CTO / senior lead | APPLY | No visa clause | "Minimum 10 years": heads-up only, verdict must stay APPLY |
| 15 | Byte Digital, Developer Programmer | TAILOR | "Job Types: Full-time, Permanent" | Word-order variant of "permanent full-time"; code matches only the exact phrases, a miss here is a genuine gap |
| 16 | MSS Security, Security Officer | SKIP | "Must be an Australian Citizen." | Also PV clearance; "Positing Vetting" typo; "sponsorship available" is for the clearance, not visa |
| 17 | AGI, Group Insurance Analyst | SKIP | "must be Australian citizens or permanent residents with full working rights" | Citizen/PR and work rights in one clause |
| 18 | Sushi Yuzen, Sushi Roll Maker | SKIP | "around 28-35hrs per week" (28 x 2 = 56 > 48) | Trap: "Australian working rights or appropriate visa" must not become a temp-visa clause; hours given as a range |
| 19 | Firepop Enmore, Front of House | APPLY | No visa clause | Trap: application question "Do you have an appropriate right to work ... visa type" is a question, not a requirement; "five day working week" is not hours |
| 20 | Infosys, Lead Engineering Operations | APPLY | "Australian Citizenship or Permanent Residency preferred" is under "Preferred" | Trap: soft preference must not become a citizenship requirement; 12 years is a heads-up |

Class counts: APPLY 9, SKIP 7, TAILOR 4 (WHV pattern = 2 of the 4).

## Known limitations (2 ads, reported separately, NOT scored)

Hours are only checked when the ad states weekly hours. These two imply hours (days x hours per day) without stating them.

| # | Ad | Expected by rules | Expected by a human | Why |
|---|----|-------------------|---------------------|-----|
| L1 | Breitling Boutique, casual retail | APPLY | likely SKIP | "3 days per week", no weekly hours |
| L2 | Japanese restaurant FOH, Waterloo | APPLY | SKIP | 09:30-20:30 with 1-1.5h break, 3-4 days = about 28-40 h/week, not stated |

## Run protocol
1. Commit this file and the 22 verbatim ad texts (unedited, typos kept) in one commit BEFORE any run.
2. Run once on production with a temporary eval token, then remove the token.
3. Do not change code and re-run to improve the score. If code is changed because of a failure, this
   set becomes a dev set and new ads are needed for any further accuracy claim.
4. Report: overall X/20, per class (APPLY / SKIP / TAILOR), each miss with cause
   (extraction / rule / label), and the 2 limitation ads separately.
