# Labelling policy

This policy defines what Mintx treats as personal data. Every dataset, model and evaluation in `ml/` follows it.

**Principle:** mask information that identifies, or helps single out, a *private individual*. Keep information that is public, or shared by so many people that it does not narrow down who someone is. Masking public context only makes the assistant less useful without protecting anyone.

## Labels: mask these

| Label | What it covers | Examples |
| --- | --- | --- |
| `PERSON` | Names of private people, including first-name-only and surname-only mentions, and usernames or handles that refer to a person. Titles such as Mr, Dr and Mrs are excluded from the span. | Priya Sharma, Rahul, Ms. **Iyer**, @priyanka_codes |
| `EMAIL` | Email addresses | priya.s@example.org |
| `PHONE` | Phone and fax numbers in any format | +91 98450 12345, (415) 555-0132 |
| `ADDRESS` | Street addresses: building number, street, locality and postal code, as one span when adjacent | 42 MG Road, Bengaluru 560001 |
| `LOCATION` | A city, town, neighbourhood or village mentioned on its own | Koramangala, Pune, Austin |
| `ORGANIZATION` | Small or private organizations, such as an employer, a shop or a clinic | Zentrix Labs, Sharma Traders |
| `DATE_OF_BIRTH` | Dates that are someone's birth date | DOB: 14/08/1992 |
| `GOV_ID` | Government and tax identifiers: Aadhaar, PAN, passport, SSN, driving licence, voter ID, national ID, tax number | 2345 6789 0124, ABCPE1234F |
| `CREDIT_CARD` | Payment card numbers | 4111 1111 1111 1111 |
| `BANK_ACCOUNT` | IBAN and bank account numbers | GB82 WEST 1234 5698 7654 32 |
| `UPI_ID` | UPI virtual payment addresses | ananya@okaxis |
| `IP_ADDRESS` | IPv4 and IPv6 addresses | 203.0.113.42 |
| `SECRET` | Passwords, API keys, access tokens, private keys | sk-proj-…, ghp_…, password: hunter2 |

## Keep visible: not personal data under this policy

| Kind | Examples | Why |
| --- | --- | --- |
| Countries, continents, states and provinces | India, USA, IN, Karnataka, Europe | Shared by millions; does not single anyone out |
| Large public organizations | Google, Infosys, Reserve Bank of India, WHO | Public institutions; a link to one alone does not identify a person |
| Public figures, in their public role | Narendra Modi, Sundar Pichai | Not private individuals |
| Ordinary dates and times | the meeting on 3 March, 10:30 am | Not about a person's identity |
| Age, gender, sex, titles | 34 years old, female, Dr | Attributes rather than identifiers. They are sensitive in combination, which is out of scope here and listed as a limitation |
| Business identifiers | invoice, order and ticket numbers, commit hashes, versions, prices | Do not identify a person |
| Document and field names | Aadhaar, PAN, UPI, "Email", "Phone" | The *name* of an ID type is not the ID |

Public entities are recorded in each example's `keep` list so that the learned classifier sees them as explicit negative examples.

## Mapping from ai4privacy OpenPII 1.5M

| ai4privacy label | Mintx label |
| --- | --- |
| `GIVENNAME`, `SURNAME` | `PERSON`. Adjacent parts are merged into one span. |
| `EMAIL` | `EMAIL` |
| `TELEPHONENUM` | `PHONE` |
| `STREET`, `BUILDINGNUM`, `ZIPCODE`, and a `CITY` directly attached to them | `ADDRESS` (merged into one span) |
| `CITY` on its own | `LOCATION`, or *keep* if it is a country or state, e.g. "Singapore" |
| `DATE` | `DATE_OF_BIRTH` when birth words ("born", "DOB", "date of birth", "birthday") appear within 40 characters before it; otherwise not masked |
| `IDCARDNUM`, `DRIVERLICENSENUM`, `PASSPORTNUM`, `SOCIALNUM`, `TAXNUM` | `GOV_ID` |
| `CREDITCARDNUMBER` | `CREDIT_CARD` |
| `TITLE`, `AGE`, `SEX`, `GENDER` | not masked |

This relabelling is rule-based (weak supervision), so it is imperfect. For example, a birth date written far from any birth word becomes an ordinary date. The realistic test set is hand-checked to measure that noise.
