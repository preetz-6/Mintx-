// Entity type families. Rule layers use specific types (AADHAAR, PAN…); the fine-tuned model
// uses broader ones (GOV_ID). Types in one family describe the same kind of value.
export const FAMILIES = { AADHAAR: "GOV_ID", PAN: "GOV_ID", SSN: "GOV_ID", PASSPORT: "GOV_ID",
  IBAN: "BANK_ACCOUNT", POSTAL_CODE: "ADDRESS" };
export const family = type => FAMILIES[type] || type;
export const FAMILY_LIST = ["PERSON", "EMAIL", "PHONE", "ADDRESS", "LOCATION", "ORGANIZATION", "DATE_OF_BIRTH", "GOV_ID",
  "CREDIT_CARD", "BANK_ACCOUNT", "UPI_ID", "IP_ADDRESS", "SECRET"];
