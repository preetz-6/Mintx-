"""Fake-value generators. Identifiers are format- and checksum-valid (Luhn, Verhoeff, IBAN
mod-97) so the data teaches real patterns, but every value is random and fictional."""
from __future__ import annotations

import random
import string
import uuid

from faker import Faker

from common import PUBLIC

LOCALES = {"en_IN": 0.6, "en_US": 0.3, "en_GB": 0.1}
FAKERS = {loc: Faker(loc) for loc in LOCALES}
PUBLIC_LOWER = {v.lower() for vals in PUBLIC.values() for v in vals}

INDIAN_LOCALITIES = ["Koramangala", "Indiranagar", "Whitefield", "Jayanagar", "HSR Layout", "Andheri West", "Bandra East",
    "Powai", "Thane West", "Kothrud", "Hinjewadi", "Baner", "Salt Lake", "Ballygunge", "Banjara Hills", "Gachibowli",
    "Madhapur", "T. Nagar", "Adyar", "Velachery", "Anna Nagar", "Saket", "Dwarka", "Rohini", "Lajpat Nagar",
    "Vasant Kunj", "Gomti Nagar", "Navrangpura", "Satellite", "Kakkanad", "Edappally", "Aundh", "Malviya Nagar"]
UPI_HANDLES = ["okaxis", "oksbi", "okhdfcbank", "okicici", "ybl", "ibl", "axl", "paytm", "upi", "apl", "ptyes"]
EMAIL_DOMAINS = ["gmail.com", "yahoo.co.in", "outlook.com", "hotmail.com", "rediffmail.com", "proton.me", "icloud.com"]
ORG_WORDS = ["Zentrix", "Nimbus", "Orbitra", "Kavya", "Sutra", "Vriksha", "Tejas", "Quanta", "Lumen", "Arka", "Halcyon",
    "Pixelnest", "Bluegrain", "Saffron", "Indus Valley", "Greenleaf", "Brightpath", "Northwind", "Copperline", "Vertex"]
ORG_SUFFIXES = ["Labs", "Technologies", "Analytics Pvt Ltd", "Solutions LLP", "Traders", "Enterprises", "Clinic",
    "Diagnostics", "Public School", "Studios", "Logistics", "Foods", "Consulting", "Textiles", "Pharma"]
PASSWORD_WORDS = ["Sunshine", "Monsoon", "Mango", "Tiger", "Cricket", "Falcon", "Winter", "Coffee", "Rocket", "Lotus"]


class Gen:
    """Generates consistent fake values. One instance per rendered example."""

    def __init__(self, rng: random.Random):
        self.rng = rng
        self.locale = rng.choices(list(LOCALES), weights=list(LOCALES.values()))[0]
        self.fake = FAKERS[self.locale]
        self.fake.seed_instance(rng.randrange(1 << 30))
        self.people: dict[str, dict] = {}

    def choice(self, seq):
        return self.rng.choice(seq)

    def digits(self, n: int) -> str:
        return "".join(self.rng.choice(string.digits) for _ in range(n))

    # --- people and contact -----------------------------------------------------------
    def person(self, key: str = "") -> dict:
        if key not in self.people:
            for _ in range(20):
                first, last = self.fake.first_name(), self.fake.last_name()
                if f"{first} {last}".lower() not in PUBLIC_LOWER and first.lower() not in PUBLIC_LOWER:
                    break
            self.people[key] = {"first": first, "last": last, "full": f"{first} {last}"}
        return self.people[key]

    def email(self, person: dict | None = None) -> str:
        dom = self.choice(EMAIL_DOMAINS)
        if person and self.rng.random() < 0.8:
            f, l = person["first"].lower(), person["last"].lower()
            local = self.choice([f"{f}.{l}", f"{f}{l}", f"{f[0]}{l}", f"{f}_{l}{self.digits(2)}", f"{f}{self.digits(3)}"])
            local = "".join(c for c in local if c.isalnum() or c in "._")
            return f"{local}@{dom}"
        return f"{self.fake.user_name()}{self.digits(2)}@{dom}"

    def phone(self) -> str:
        if self.locale == "en_IN" or self.rng.random() < 0.3:
            n = self.choice("6789") + self.digits(9)
            return self.choice([f"+91 {n[:5]} {n[5:]}", f"+91-{n}", f"0{n}", f"{n[:5]} {n[5:]}", n, f"+91 {n[:3]} {n[3:6]} {n[6:]}"])
        if self.locale == "en_US":
            a, b, c = self.choice(["415", "212", "646", "312", "617", "206"]), self.digits(3), self.digits(4)
            return self.choice([f"({a}) {b}-{c}", f"+1 {a}-{b}-{c}", f"{a}.{b}.{c}", f"{a}-{b}-{c}"])
        return f"+44 {self.choice(['20', '161', '121'])} {self.digits(4)} {self.digits(4)}"

    def address(self) -> str:
        if self.locale == "en_IN":
            f = self.fake
            parts = [f"{self.rng.randint(1, 999)}", f.street_name(), self.choice(INDIAN_LOCALITIES), f.city()]
            pin = f"{self.rng.randint(1, 9)}{self.digits(5)}"
            return self.choice([f"{parts[0]}, {parts[1]}, {parts[2]}, {parts[3]} {pin}",
                                f"#{parts[0]}, {parts[1]}, {parts[3]} - {pin}", f"{parts[0]} {parts[1]}, {parts[3]} {pin}"])
        f = self.fake
        if self.locale == "en_US":
            return f"{f.street_address()}, {f.city()}, {f.state_abbr()} {f.zipcode()}"
        return f"{f.building_number()} {f.street_name()}, {f.city()} {f.postcode()}"

    def location(self) -> str:
        if self.locale == "en_IN" and self.rng.random() < 0.5:
            return self.choice(INDIAN_LOCALITIES)
        return self.fake.city()

    def org(self) -> str:
        if self.rng.random() < 0.6:
            head = self.choice(ORG_WORDS + [self.fake.last_name()])
            return f"{head} {self.choice(ORG_SUFFIXES)}"
        name = self.fake.company()
        return name if name.lower() not in PUBLIC_LOWER else f"{name} Group"

    def dob(self) -> str:
        d = self.fake.date_of_birth(minimum_age=18, maximum_age=80)
        return self.choice([d.strftime("%d/%m/%Y"), d.strftime("%d-%m-%Y"), d.strftime("%Y-%m-%d"),
                            d.strftime("%d %B %Y"), d.strftime("%B %d, %Y"), d.strftime("%d %b %Y")])

    # --- identifiers -----------------------------------------------------------------
    def aadhaar(self) -> str:
        n = self.choice("23456789") + self.digits(10)
        n += str(verhoeff_check(n))
        return self.choice([f"{n[:4]} {n[4:8]} {n[8:]}", f"{n[:4]}-{n[4:8]}-{n[8:]}", n])

    def pan(self) -> str:
        letters = "".join(self.choice(string.ascii_uppercase) for _ in range(3))
        return f"{letters}{self.choice('PPPPPCHFATBLJG')}{self.choice(string.ascii_uppercase)}{self.digits(4)}{self.choice(string.ascii_uppercase)}"

    def passport(self) -> str:
        return f"{self.choice('ABCDEFGHJKLMNPRSTUVWZ')}{self.rng.randint(1, 9)}{self.digits(6)}"

    def ssn(self) -> str:
        return f"{self.rng.randint(100, 665)}-{self.rng.randint(10, 99)}-{self.rng.randint(1000, 9999)}"

    def voter_id(self) -> str:
        return "".join(self.choice(string.ascii_uppercase) for _ in range(3)) + self.digits(7)

    def driving_licence(self) -> str:
        return f"{self.choice(['KA', 'MH', 'DL', 'TN', 'TS', 'WB', 'UP'])}{self.digits(2)} {self.rng.randint(2005, 2024)}{self.digits(7)}"

    def gov_id(self) -> str:
        return self.choice([self.aadhaar, self.pan, self.passport, self.voter_id, self.driving_licence, self.ssn])()

    def card(self) -> str:
        kind = self.choice(["visa", "visa", "mc", "rupay", "amex"])
        prefix = {"visa": "4", "mc": f"5{self.rng.randint(1, 5)}", "rupay": "60", "amex": self.choice(["34", "37"])}[kind]
        length = 15 if kind == "amex" else 16
        body = prefix + self.digits(length - len(prefix) - 1)
        n = body + str(luhn_check(body))
        if kind == "amex":
            return self.choice([f"{n[:4]} {n[4:10]} {n[10:]}", n])
        return self.choice([" ".join(n[i:i + 4] for i in range(0, 16, 4)), "-".join(n[i:i + 4] for i in range(0, 16, 4)), n])

    def iban(self) -> str:
        bank = "".join(self.choice(string.ascii_uppercase) for _ in range(4))
        bban = bank + self.digits(14)
        check = iban_check("GB", bban)
        raw = f"GB{check:02d}{bban}"
        return " ".join(raw[i:i + 4] for i in range(0, len(raw), 4))

    def bank_account(self) -> str:
        return self.iban() if self.rng.random() < 0.3 else self.digits(self.rng.randint(11, 16))

    def upi(self, person: dict | None = None) -> str:
        p = person or self.person("upi")
        local = self.choice([p["first"].lower(), f"{p['first'].lower()}.{p['last'][0].lower()}", self.digits(10),
                             f"{p['first'].lower()}{self.digits(2)}"])
        return f"{local}@{self.choice(UPI_HANDLES)}"

    def ip(self) -> str:
        if self.rng.random() < 0.15:
            return ":".join(f"{self.rng.randrange(65536):x}" for _ in range(8))
        return ".".join(str(self.rng.randint(1, 254)) for _ in range(4))

    def secret(self) -> str:
        r = self.rng
        alnum = string.ascii_letters + string.digits
        s = lambda n, cs=alnum: "".join(r.choice(cs) for _ in range(n))  # noqa: E731
        return r.choice([f"sk-proj-{s(40)}", f"sk-{s(48)}", f"ghp_{s(36)}", f"AKIA{s(16, string.ascii_uppercase + string.digits)}",
                         f"xoxb-{self.digits(12)}-{s(24)}", f"AIza{s(35)}", f"rk_live_{s(24)}",
                         f"eyJ{s(20)}.eyJ{s(30)}.{s(27)}"])

    def password(self) -> str:
        return self.choice([f"{self.choice(PASSWORD_WORDS)}@{self.digits(4)}", f"{self.choice(PASSWORD_WORDS).lower()}{self.digits(3)}!",
                            "".join(self.choice(string.ascii_letters + string.digits + "#$%") for _ in range(12))])

    # --- values to keep visible (public) ---------------------------------------------------
    def pub_org(self) -> str: return self.choice(PUBLIC["organization"])
    def country(self) -> str: return self.choice([c for c in PUBLIC["country"] if len(c) > 2])
    def code(self) -> str: return self.choice(["IN", "US", "UK", "UAE", "SG", "AU", "CA", "DE", "GB", "EU"])
    def state(self) -> str: return self.choice(PUBLIC["region"])
    def figure(self) -> str: return self.choice(PUBLIC["public_figure"])

    # --- look-alike values that are not personal data --------------------------------------
    def date(self) -> str:
        d = self.fake.date_between(start_date="-2y", end_date="+1y")
        return self.choice([d.strftime("%d/%m/%Y"), d.strftime("%d %B %Y"), d.strftime("%B %d"), d.strftime("%Y-%m-%d"),
                            d.strftime("%d %b"), d.strftime("%A, %d %B")])
    def time(self) -> str: return self.choice([f"{self.rng.randint(1, 12)}:{self.choice(['00', '15', '30', '45'])} {self.choice(['am', 'pm', 'AM', 'PM'])}", f"{self.rng.randint(0, 23):02d}:{self.rng.randint(0, 59):02d}"])
    def price(self) -> str: return self.choice([f"₹{self.rng.randint(99, 99999):,}", f"Rs. {self.rng.randint(99, 9999)}", f"${self.rng.randint(5, 999)}.{self.digits(2)}", f"INR {self.rng.randint(500, 250000):,}"])
    def invoice(self) -> str: return self.choice([f"INV-{self.rng.randint(2022, 2026)}-{self.digits(4)}", f"#{self.digits(6)}", f"BILL/{self.digits(5)}"])
    def order(self) -> str: return self.choice([f"OD{self.digits(15)}", f"#{self.choice('ABCDEFGH')}-{self.digits(5)}", f"{self.digits(3)}-{self.digits(7)}-{self.digits(7)}"])
    def ticket(self) -> str: return self.choice([f"#{self.digits(4)}", f"JIRA-{self.digits(4)}", f"SR{self.digits(8)}", f"CASE-{self.digits(6)}"])
    def version(self) -> str: return f"{self.rng.randint(0, 9)}.{self.rng.randint(0, 20)}.{self.rng.randint(0, 30)}"
    def hash(self) -> str: return "".join(self.choice("0123456789abcdef") for _ in range(self.choice([7, 10, 40])))
    def uuid(self) -> str: return str(uuid.UUID(int=self.rng.getrandbits(128)))
    def percent(self) -> str: return f"{self.rng.randint(1, 99)}%"
    def num(self) -> str: return str(self.rng.randint(2, 50000))
    def ifsc(self) -> str: return f"{self.choice(['HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK'])}0{self.digits(6)}"


# --- checksum helpers --------------------------------------------------------------------
_VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
       [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
       [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
_VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
       [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
_VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_check(digits: str) -> int:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VD[c][_VP[(i + 1) % 8][int(ch)]]
    return _VINV[c]


def verhoeff_valid(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VD[c][_VP[i % 8][int(ch)]]
    return c == 0


def luhn_check(body: str) -> int:
    total = 0
    for i, ch in enumerate(reversed(body)):
        d = int(ch)
        if i % 2 == 0:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return (10 - total % 10) % 10


def iban_check(country: str, bban: str) -> int:
    rearranged = bban + country + "00"
    num = "".join(str(int(c, 36)) for c in rearranged)
    return 98 - int(num) % 97
