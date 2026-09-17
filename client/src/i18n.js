/**
 * Every visible string in the app.
 *
 * There is no fallback to English. A missing key throws, loudly, in
 * development — because a runtime fallback is the one thing guaranteed to
 * produce a half-translated screen, silently, in production, on the page
 * nobody tested. One language at a time, never two.
 *
 * The Tamil here is a first pass and needs reviewing by someone who uses these
 * words daily. Translate the meaning, not the words: the right word for
 * "outstanding" is the one a distributor says, not the one a dictionary gives.
 */

export const LANGUAGES = [
  { code: "en", endonym: "English" },
  { code: "ta", endonym: "தமிழ்" }
];

const STRINGS = {
  en: {
    brand: "CashFlow Ledger",
    signIn: "Who is using this phone?", enterPin: "Enter PIN", wrongPin: "That PIN is not right.",
    signOut: "Sign out", offline: "Saved on this phone. It will sync when there is signal.",

    collectedToday: "Collected today", totalOutstanding: "Total outstanding",
    shopCount: (n) => `${n} ${n === 1 ? "shop owes" : "shops owe"}`,
    longestOutstanding: "Longest outstanding", tapHint: "Tap a shop for its history",
    sendReminder: "Reminder", print: "Print", excel: "Excel",
    days: (n) => `${n} ${n === 1 ? "day" : "days"}`,

    delivery: "Delivery", payment: "Payment", opening: "Opening balance",
    route: "Route", shop: "Shop", allRoutes: "All",
    entryKind: "What are you recording?", whichDay: "Which day?",
    today: "Today", yesterday: "Yesterday",
    del: "Delete", save: "Save", back: "Back",

    tabRecord: "Record", tabShops: "Shops", tabDay: "Day",
    todayEntries: "Today's entries", noEntries: "Nothing recorded yet today.",
    undo: "Undo", reversedTag: "REVERSED", reversalTag: "CORRECTION",
    recorded: (kind, amount, shop) => `${kind} ${amount} saved for ${shop}.`,
    undone: (shop) => `Reversed. ${shop} is back to its earlier balance.`,

    addShop: "Add shop", newShop: "New shop", editShop: "Edit shop",
    fName: "Shop name", fNameHint: "English letters, the way it is written on the shop board.",
    fPhone: "WhatsApp number", fPhoneHint: "10 digits. Needed to send reminders.",
    fRoute: "Route", fOpening: "Amount already owed",
    fOpeningHint: "What the notebook shows for this shop today. Leave 0 if nothing is owed.",
    addRoute: "Add route", routeName: "Route",
    dupWarn: (n) => `“${n}” is already in the list. Adding it again splits one shop's dues in two.`,
    needName: "Enter the shop name.", needPhone: "Enter a 10-digit number.",
    shopSaved: (n) => `${n} added.`, shopUpdated: (n) => `${n} updated.`,
    archive: "Archive shop", archived: "Archived", unarchive: "Bring back",
    archiveNote: "Archiving hides the shop from entry. Its history is kept and nothing is deleted.",
    shopArchived: (n) => `${n} archived. Its history is kept.`,
    shopsCount: (n) => `${n} ${n === 1 ? "shop" : "shops"}`,

    history: "History", balanceNow: "Balance now", oldestUnpaid: "Oldest unpaid",
    phone: "WhatsApp", noPhone: "No number yet", runningBal: "Balance after",

    dayTitle: "Day close", dayCollected: "Cash collected today", dayDelivered: "Goods delivered today",
    dayCount: (n) => `${n} ${n === 1 ? "payment" : "payments"}`,
    dayHandover: "Hand this amount to the owner tonight.",

    sheetTitle: "Outstanding list", colShop: "Shop", colRoute: "Route", colDays: "Days", colAmount: "Amount",
    totalRow: (n) => `Total · ${n} ${n === 1 ? "shop" : "shops"}`, page: "Page 1 / 1",
    printTitle: "Today's sheet", printNow: "Print", printSub: "One page, every shop that owes.",
    excelTitle: "Excel", saveFile: "Save the file", excelSub: "Every outstanding shop, plain numbers for the accountant.",
    downloading: "Preparing the file…", downloaded: "Saved to your downloads.",

    reminderTitle: "Reminder", reminderFor: "To", pickShop: "Which shop?",
    reminderMsg: (shop, amount, days) =>
      `Hello. ${shop} — outstanding ${amount}, ${days}. Please let us know when convenient. Thank you.`,
    sendWhatsapp: "Send on WhatsApp", cancel: "Cancel",
    sentAlready: (d) => `Last reminded ${d}.`, neverReminded: "Not reminded yet.",
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  },

  ta: {
    brand: "கேஷ்ஃப்ளோ லெட்ஜர்",
    signIn: "இந்த ஃபோனை யார் பயன்படுத்துகிறார்?", enterPin: "PIN உள்ளிடவும்", wrongPin: "PIN சரியில்லை.",
    signOut: "வெளியேறு", offline: "இந்த ஃபோனில் சேமிக்கப்பட்டது. சிக்னல் வந்ததும் அனுப்பப்படும்.",

    collectedToday: "இன்று வசூல்", totalOutstanding: "மொத்த நிலுவை",
    shopCount: (n) => `${n} கடைகளில் நிலுவை`,
    longestOutstanding: "அதிக நாள் நிலுவை", tapHint: "விவரம் பார்க்க கடையைத் தட்டவும்",
    sendReminder: "நினைவூட்டல்", print: "அச்சிடு", excel: "Excel",
    days: (n) => `${n} நாள்`,

    delivery: "டெலிவரி", payment: "பணம்", opening: "தொடக்க நிலுவை",
    route: "வழி", shop: "கடை", allRoutes: "அனைத்தும்",
    entryKind: "எதைப் பதிவு செய்கிறீர்கள்?", whichDay: "எந்த நாள்?",
    today: "இன்று", yesterday: "நேற்று",
    del: "அழி", save: "சேமி", back: "பின்",

    tabRecord: "பதிவு", tabShops: "கடைகள்", tabDay: "நாள்",
    todayEntries: "இன்றைய பதிவுகள்", noEntries: "இன்று இதுவரை பதிவு இல்லை.",
    undo: "திரும்பப் பெறு", reversedTag: "திரும்பப் பெற்றது", reversalTag: "திருத்தம்",
    recorded: (kind, amount, shop) => `${shop} — ${kind} ${amount} சேமிக்கப்பட்டது.`,
    undone: (shop) => `திரும்பப் பெறப்பட்டது. ${shop} முந்தைய நிலுவைக்குத் திரும்பியது.`,

    addShop: "கடை சேர்", newShop: "புதிய கடை", editShop: "கடையைத் திருத்து",
    fName: "கடை பெயர்", fNameHint: "கடை பலகையில் உள்ளபடி, ஆங்கில எழுத்தில்.",
    fPhone: "WhatsApp எண்", fPhoneHint: "10 இலக்கம். நினைவூட்டல் அனுப்ப தேவை.",
    fRoute: "வழி", fOpening: "ஏற்கனவே உள்ள நிலுவை",
    fOpeningHint: "இன்று நோட்டில் உள்ள தொகை. நிலுவை இல்லை என்றால் 0.",
    addRoute: "வழி சேர்", routeName: "வழி",
    dupWarn: (n) => `“${n}” ஏற்கனவே பட்டியலில் உள்ளது. மீண்டும் சேர்த்தால் ஒரே கடையின் நிலுவை இரண்டாகப் பிரியும்.`,
    needName: "கடை பெயரை உள்ளிடவும்.", needPhone: "10 இலக்க எண்ணை உள்ளிடவும்.",
    shopSaved: (n) => `${n} சேர்க்கப்பட்டது.`, shopUpdated: (n) => `${n} திருத்தப்பட்டது.`,
    archive: "கடையை நீக்கி வை", archived: "நீக்கி வைக்கப்பட்டவை", unarchive: "மீண்டும் சேர்",
    archiveNote: "பதிவுத் திரையில் இருந்து மறையும். வரலாறு அப்படியே இருக்கும், எதுவும் அழிக்கப்படாது.",
    shopArchived: (n) => `${n} நீக்கி வைக்கப்பட்டது. வரலாறு பாதுகாக்கப்படுகிறது.`,
    shopsCount: (n) => `${n} கடைகள்`,

    history: "வரலாறு", balanceNow: "தற்போதைய நிலுவை", oldestUnpaid: "பழைய நிலுவை",
    phone: "WhatsApp", noPhone: "எண் இல்லை", runningBal: "பிறகு நிலுவை",

    dayTitle: "நாள் முடிவு", dayCollected: "இன்று வசூல் ஆன பணம்", dayDelivered: "இன்று டெலிவரி",
    dayCount: (n) => `${n} பணப் பதிவு`,
    dayHandover: "இந்தத் தொகையை இன்று இரவு முதலாளியிடம் ஒப்படைக்கவும்.",

    sheetTitle: "நிலுவை பட்டியல்", colShop: "கடை", colRoute: "வழி", colDays: "நாள்", colAmount: "தொகை",
    totalRow: (n) => `மொத்தம் · ${n} கடைகள்`, page: "பக்கம் 1 / 1",
    printTitle: "இன்றைய பட்டியல்", printNow: "அச்சிடு", printSub: "ஒரு பக்கம், நிலுவை உள்ள அனைத்துக் கடைகளும்.",
    excelTitle: "Excel", saveFile: "கோப்பைச் சேமி", excelSub: "நிலுவை உள்ள அனைத்துக் கடைகளும், கணக்காளருக்கான எளிய எண்கள்.",
    downloading: "கோப்பு தயாராகிறது…", downloaded: "பதிவிறக்கத்தில் சேமிக்கப்பட்டது.",

    reminderTitle: "நினைவூட்டல்", reminderFor: "யாருக்கு", pickShop: "எந்தக் கடை?",
    reminderMsg: (shop, amount, days) =>
      `வணக்கம். ${shop} — நிலுவை ${amount}, ${days}. வசதிப்படும்போது தெரிவிக்கவும். நன்றி.`,
    sendWhatsapp: "WhatsApp-ல் அனுப்பு", cancel: "வேண்டாம்",
    sentAlready: (d) => `கடைசி நினைவூட்டல் ${d}.`, neverReminded: "இதுவரை நினைவூட்டல் இல்லை.",
    weekday: ["ஞாயிறு", "திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி"]
  }
};

export function t(lang, key) {
  const value = STRINGS[lang]?.[key];
  if (value === undefined) { throw new Error(`Missing string "${key}" in ${lang}`); }
  return value;
}

/** Indian digit grouping, whole rupees, in every language. */
export function group(n) {
  const s = String(Math.abs(Math.round(n)));
  if (s.length <= 3) { return s; }
  return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3);
}

export const rupees = (n) => "₹ " + group(n);

/** DD-MM-YYYY, the notebook's format, in every language. */
export function dmy(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
