# Job Ad Corpus — Raw Material for Labelling
Collected 19 Sept 2026. Real employers, real quoted phrases from live listings on SEEK and government career sites.

**How to finish each one:** For entries marked [SEEK], click the listing link, use ctrl+F for the quoted phrase to find the specific ad named, open it, and copy the full ad text into its own file (`ads/01_citizenship_civil_eng.txt` etc). For entries marked [DIRECT], the permalink is fetchable as-is — copy the quoted eligibility text plus the rest of the ad body.

Target: 40–50 total for the full corpus. This gives you 25 solid starter leads across all six categories — duplicate the search pattern (swap job title/suburb) to pad out the rest fast once Tier 1 rules are drafted, since you'll know exactly which phrases you're hunting for.

---

## Category 1: Government / APS (hard blockers — Tier 1 test cases)

1. **[DIRECT] APS Graduate Program — Data Stream**
   https://content.apsjobs.gov.au/career-pathways/graduate-programs/data-stream
   Quote: *"Be an Australian citizen at the time of application."* / *"able to obtain and maintain a valid Australian Government security clearance"*
   Expected verdict: **Skip** (citizenship + clearance)

2. **[DIRECT] APS Graduate Program — STEM Stream**
   https://content.apsjobs.gov.au/career-pathways/graduate-programs/stem-stream
   Quote: *"Be an Australian citizen at the time of application."*
   Expected verdict: **Skip**

3. **[DIRECT] APS Graduate Program — Generalist Stream**
   https://content.apsjobs.gov.au/career-pathways/graduate-programs/generalist-stream
   Quote: *"Be an Australian citizen at the time of application."* / *"valid Australian Government security clearance when required"*
   Expected verdict: **Skip**

4. **[DIRECT] DFAT 2027 Graduate Program**
   https://www.dfat.gov.au/careers/dfat-aps-careers/graduate-program
   Quote: security clearance listed as *"Negative Vetting Level 2"*; standard APS citizenship eligibility
   Expected verdict: **Skip**

5. **[DIRECT] NSW Health — Senior Data Analyst (closed listing, good for Tier 2 phrasing)**
   https://jobs.health.nsw.gov.au/jobs/senior-data-analyst-195675
   Quote: *"requires full working rights in Australia for the duration of the assignment... an Australian Citizen, or a permanent resident... or a citizen of another country with an appropriate visa that allows you to work in Australia"*
   Expected verdict: **Tailor** — good edge case: explicitly does NOT block temporary visa holders, unlike the APS ones. Useful for teaching Tier 1 vs Tier 2 apart.

6. **[SEEK] APS4 Contact Centre roles via Randstad, national**
   https://www.seek.com.au/aps-graduate-jobs/in-Western-Australia-WA
   Quote: *"Australian citizenship required"*
   Expected verdict: **Skip**

---

## Category 2: Big 4 / Graduate Consulting

7. **[SEEK] Deloitte Graduate Program (Business Advisory / Tax Advisory / Accounting & Audit streams)**
   https://www.seek.com.au/deloitte-graduate-jobs/in-Sydney-CBD,-Inner-West-&-Eastern-Suburbs-Sydney-NSW/full-time
   No citizenship/visa restriction mentioned in snippet — click through and confirm; likely **Apply** or ambiguous, useful as a "no explicit blocker" test case.

8. **[SEEK] KPMG — various Sydney roles**
   https://www.seek.com.au/KPMG-jobs/in-All-Sydney-NSW
   Click through to a graduate-level listing; test for visa language.

9. **[SEEK] "Must have consulting experience (KPMG, Deloitte, EY, PWC or similar)" — Data Governance Manager**
   https://www.seek.com.au/data-governance-manager-jobs/in-Macquarie-Park-NSW-2113
   Not a visa blocker — an experience blocker (Tier 3 fit signal, not Tier 1/2). Good ad for showing the tool correctly does NOT flag it as visa-related.

---

## Category 3: Tech / Data — Startups and Graduate SWE roles

10. **[SEEK] Recent graduate C++ role, "an Australian citizen" required**
    https://www.seek.com.au/software-developer-internship-jobs
    Quote: *"Are you a recent graduate, passionate about C++ and an Australian citizen, we want to hear from you!"*
    Expected verdict: **Skip**

11. **[SEEK] .NET/C#/Dynamics CRM developer, Sydney Olympic Park**
    https://www.seek.com.au/jobs-in-information-communication-technology/developers-programmers/in-Kemps-Creek-NSW-2178
    Quote: *"Australian citizen or PR"*
    Expected verdict: **Skip**

12. **[SEEK] Data Engineer / Senior Data Modeller / Senior Data Analyst**
    https://www.seek.com.au/Data-Engineering-jobs
    Quote: *"Australian PR holders or Australian Citizens"*
    Expected verdict: **Skip**

13. **[SEEK] "Well-funded AI startup" — no visa restriction mentioned**
    Same page as above, second listing in snippet.
    No citizenship/visa signal — good **Apply** example. Confirm full text on click-through.

14. **[SEEK] Federal agency AI strategy contract role**
    https://www.seek.com.au/data-scientist-jobs/in-All-Sydney-NSW/contract-temp
    Quote: *"Australian Citizenship required"* (separate listing on same page, Python-based applications role)
    Expected verdict: **Skip**

---

## Category 4: Healthcare (AHPRA registration — a different kind of Tier 1 blocker)

15. **[SEEK] Graduate Registered Nurse, Chester Hill**
    https://www.seek.com.au/general-practice-nurse-jobs/in-Appin-NSW-2560
    Quote: *"You will need to have a current registration with Australian Health Practitioner Regulation Agency (AHPRA)"*
    Expected verdict: **Tailor/Skip depending on AHPRA status** — good test for a non-visa hard blocker (professional registration), separate from citizenship.

16. **[SEEK] RN roles, various Sydney hospitals**
    https://www.seek.com.au/sydney-registered-nurse-jobs
    Quote: *"AHPRA & experience required"*

17. **[SEEK] Bupa Aged Care RN, part-time**
    https://www.seek.com.au/graduate-registered-nurse-jobs
    Quote: *"AHPRA Registration is essential"* + *"A minimum of 12 months experience as an RN is required"*
    Good combined Tier1 (registration) + Tier3 (experience) test case.

18. **[SEEK] Aged care group — "working visas considered for overseas applicants"**
    https://www.seek.com.au/ahpra-limited-registration-jobs
    Explicitly visa-friendly — good **Apply/Tailor** counter-example against the blockers above.

---

## Category 5: Retail / Hospitality (open roles — the "should apply" baseline)

19. **[SEEK] Casual Sales Assistant, "No sales experience required — full paid training provided"**
    https://www.seek.com.au/casual-sales-jobs/in-All-Sydney-NSW
    No visa/citizenship language. Expected verdict: **Apply**

20. **[SEEK] Windsor Smith Retail — Retail Sales Assistant, Sydney Central Westfield**
    https://www.seek.com.au/casual-sales-assistant-jobs/in-All-Sydney-NSW
    No visa/citizenship language. Expected verdict: **Apply**

21. **[SEEK] "Retail & Hospitality Staff — We Want You!" — No Experience Necessary**
    https://www.seek.com.au/retail-no-experience-jobs/in-All-Sydney-NSW
    Expected verdict: **Apply**

---

## Bonus category: Explicit sponsorship language (Tier 2 test cases — nuanced, not blockers)

22. **[SEEK] Head office customer support role, Parramatta — "Visa sponsorship available!"**
    https://www.seek.com.au/visa-sponsor-jobs/full-time (VisAnswer listing)
    Expected verdict: **Apply** — sponsorship offered outright, unusually generous signal.

23. **[SEEK] Cook role, Port Macquarie — "for hospitality graduates or 485 visa holders"**
    https://www.seek.com.au/482-visa-sponsor-jobs
    Explicitly names 485 holders as welcome. Expected verdict: **Apply**

24. **[SEEK] Technician role, Wetherill Park — "full visa sponsorship on offer"**
    https://www.seek.com.au/482-visa-sponsorship-jobs/in-All-Sydney-NSW
    Expected verdict: **Apply**

25. **[SEEK] Chef role — "Must have 6+ months AU working rights. Sponsorship considered after probation."**
    https://www.seek.com.au/482-visa-sponsorship-jobs/in-All-Sydney-NSW
    Good conditional/Tailor case — sponsorship isn't immediate.

---

## What to do next
1. Open each SEEK category link, ctrl+F for the quoted phrase to find the specific ad fast, copy full text into its own `.txt` file.
2. The 6 [DIRECT] government links can be copy-pasted as-is right now — fastest 6 files in your corpus.
3. Hand-label each: Apply / Tailor / Skip, plus the blocking reason, per the PRD.
4. You're at 25 raw leads against a 40–50 target — repeat categories 3 and 5 (tech, retail) with different search terms to pad out the rest; those two categories return the most volume fastest.
