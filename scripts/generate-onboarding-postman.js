// Generates docs/MyBrainBud_Onboarding.postman_collection.json (Postman Collection v2.1)
// Run with: node scripts/generate-onboarding-postman.js
// Or: npm run postman:onboarding
const { writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");

const here = __dirname;
const outPath = join(here, "..", "docs", "MyBrainBud_Onboarding.postman_collection.json");

// Helper to build a request item (mirrors scripts/generate-postman.js).
function req(name, method, path, opts = {}) {
  const { desc = "", auth = false, body = null, test = null, examples = [] } = opts;
  const header = [{ key: "Content-Type", value: "application/json" }];
  if (auth) header.push({ key: "Authorization", value: "Bearer {{accessToken}}" });

  const item = {
    name,
    request: {
      method,
      header,
      url: {
        raw: "{{baseUrl}}" + path,
        host: ["{{baseUrl}}"],
        path: path.split("/").filter(Boolean),
      },
    },
  };
  if (desc) item.request.description = desc;
  if (body) {
    item.request.body = {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  const events = [];
  if (test) events.push({ listen: "test", script: { type: "text/javascript", exec: test.split("\n") } });
  if (events.length) item.event = events;
  if (examples.length) item.response = examples;
  return item;
}

// Helper to build a saved example response for documentation.
function example(name, method, path, code, status, body, withAuth = true) {
  const header = [{ key: "Content-Type", value: "application/json" }];
  if (withAuth) header.push({ key: "Authorization", value: "Bearer {{accessToken}}" });
  const bodyJson = JSON.stringify(body, null, 2);
  return {
    name,
    originalRequest: {
      method,
      header,
      url: {
        raw: "{{baseUrl}}" + path,
        host: ["{{baseUrl}}"],
        path: path.split("/").filter(Boolean),
      },
    },
    status,
    code,
    _postman_previewlanguage: "json",
    header: [{ key: "Content-Type", value: "application/json" }],
    cookie: [],
    body: bodyJson,
  };
}

const collection = {
  info: {
    name: "MyBrainBud Onboarding API",
    description:
      "3-step student onboarding wizard for the MyBrainBud backend (v1.1.0).\n\n" +
      "Covers the exam -> year -> subjects journey plus the completion screen, " +
      "backed by GET /api/onboarding/options (wizard choices) and " +
      "GET /api/onboarding (resume state).\n\n" +
      "SETUP:\n" +
      "1. Set `baseUrl` (defaults to http://localhost:5000).\n" +
      "2. Sign in as a STUDENT (register -> verify-otp -> login from the Auth " +
      "collection) and paste the access token into `accessToken`. All onboarding " +
      "endpoints require a STUDENT Bearer token.\n" +
      "3. Run the requests in order inside the 'Onboarding' folder:\n" +
      "   options -> state -> exam -> year -> subjects -> complete.\n" +
      "   The first two subject ids from 'options' are captured automatically " +
      "   into `subjectId1` / `subjectId2` so 'subjects' works without manual " +
      "   copy/paste.\n\n" +
      "NOTES:\n" +
      "- Exams: WAEC, JAMB, NECO, GCE. Years: YEAR_1 .. YEAR_6.\n" +
      "- Subjects: pick 1-10 active subject ids from the options response.\n" +
      "- `complete` returns 400 until exam, year, AND subjects are all set.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:5000" },
    { key: "accessToken", value: "" },
    { key: "subjectId1", value: "" },
    { key: "subjectId2", value: "" },
  ],
  item: [],
};

const optionsExampleBody = {
  success: true,
  message: "Onboarding options retrieved",
  data: {
    exams: [
      { type: "WAEC", name: "West African Examinations Council (WAEC)" },
      { type: "JAMB", name: "Joint Admissions and Matriculation Board (JAMB)" },
      { type: "NECO", name: "National Examinations Council (NECO)" },
      { type: "GCE", name: "General Certificate of Education (GCE)" },
    ],
    years: [
      { value: "YEAR_1", label: "Year 1" },
      { value: "YEAR_2", label: "Year 2" },
      { value: "YEAR_3", label: "Year 3" },
      { value: "YEAR_4", label: "Year 4" },
      { value: "YEAR_5", label: "Year 5" },
      { value: "YEAR_6", label: "Year 6" },
    ],
    subjects: [
      { id: "sub_biology", name: "Biology", code: "BIO" },
      { id: "sub_chemistry", name: "Chemistry", code: "CHEM" },
      { id: "sub_english", name: "English Language", code: "ENG" },
      { id: "sub_maths", name: "Mathematics", code: "MATH" },
      { id: "sub_physics", name: "Physics", code: "PHY" },
    ],
  },
};

const onboardingItems = [];

onboardingItems.push(
  req("GET /api/onboarding/options", "GET", "/api/onboarding/options", {
    desc:
      "Step choices for the wizard: exams, years, and active subjects.\n\n" +
      "- `exams` is a static list of the 4 supported options (WAEC/JAMB/NECO/GCE).\n" +
      "- `years` is YEAR_1 .. YEAR_6.\n" +
      "- `subjects` are the active Subject rows (id, name, code), ordered by name.\n" +
      "  Use these ids in PUT /api/onboarding/subjects.\n\n" +
      "Requires a STUDENT Bearer token.\n\n" +
      "Responses: 200 | 401 (missing/invalid token) | 403 (non-student role).",
    auth: true,
    test:
      "pm.test('status is 200', () => pm.response.to.have.status(200));\n" +
      "pm.test('returns 4 exam options', () => pm.expect(pm.response.json().data.exams).to.have.lengthOf(4));\n" +
      "pm.test('returns 6 year options', () => pm.expect(pm.response.json().data.years).to.have.lengthOf(6));\n" +
      "// Capture the first two subject ids so the subjects request works immediately.\n" +
      "if (pm.response.code === 200) {\n" +
      "  const subjects = pm.response.json().data.subjects || [];\n" +
      "  if (subjects[0]) pm.collectionVariables.set('subjectId1', subjects[0].id);\n" +
      "  if (subjects[1]) pm.collectionVariables.set('subjectId2', subjects[1].id);\n" +
      "}",
    examples: [
      example(
        "Options - 200",
        "GET",
        "/api/onboarding/options",
        200,
        "OK",
        optionsExampleBody
      ),
    ],
  }),
  req("GET /api/onboarding (state)", "GET", "/api/onboarding", {
    desc:
      "Full onboarding state so the client can resume at the right step.\n\n" +
      "- `currentStep` is one of EXAM, YEAR, SUBJECTS, COMPLETE.\n" +
      "- `exam` / `studyYear` are null until set; `subjects` starts empty.\n\n" +
      "Requires a STUDENT Bearer token.\n\n" +
      "Responses: 200 | 401 | 403 | 404 (no student profile).",
    auth: true,
    test:
      "pm.test('status is 200', () => pm.response.to.have.status(200));\n" +
      "pm.test('returns a currentStep', () => pm.expect(pm.response.json().data.currentStep).to.be.a('string'));",
    examples: [
      example(
        "State (fresh) - 200",
        "GET",
        "/api/onboarding",
        200,
        "OK",
        {
          success: true,
          message: "Onboarding state retrieved",
          data: {
            currentStep: "EXAM",
            exam: null,
            studyYear: null,
            subjects: [],
            onboardingComplete: false,
          },
        }
      ),
    ],
  }),
  req("PUT /api/onboarding/exam", "PUT", "/api/onboarding/exam", {
    desc:
      "Step 1 - save the examination the student is writing.\n\n" +
      "- `examType` must be one of: WAEC, JAMB, NECO, GCE.\n" +
      "- Links the matching Exam row to the student profile (created if missing).\n" +
      "- Response includes the new `currentStep` (YEAR after step 1).\n\n" +
      "Requires a STUDENT Bearer token.\n\n" +
      "Responses: 200 | 400 (validation / save failed) | 401 | 403 | 404.",
    auth: true,
    body: { examType: "WAEC" },
    test:
      "pm.test('status is 200', () => pm.response.to.have.status(200));\n" +
      "pm.test('exam type is WAEC', () => pm.expect(pm.response.json().data.exam.type).to.eql('WAEC'));",
    examples: [
      example(
        "Set exam - 200",
        "PUT",
        "/api/onboarding/exam",
        200,
        "OK",
        {
          success: true,
          message: "Exam selection saved",
          data: {
            exam: { type: "WAEC", name: "West African Examinations Council (WAEC)" },
            currentStep: "YEAR",
          },
        }
      ),
    ],
  }),
  req("PUT /api/onboarding/year", "PUT", "/api/onboarding/year", {
    desc:
      "Step 2 - save the student's year of study.\n\n" +
      "- `studyYear` must be one of: YEAR_1, YEAR_2, YEAR_3, YEAR_4, YEAR_5, YEAR_6.\n" +
      "- Response includes the new `currentStep` (SUBJECTS after step 2).\n\n" +
      "Requires a STUDENT Bearer token.\n\n" +
      "Responses: 200 | 400 (validation) | 401 | 403 | 404.",
    auth: true,
    body: { studyYear: "YEAR_3" },
    test:
      "pm.test('status is 200', () => pm.response.to.have.status(200));\n" +
      "pm.test('study year is YEAR_3', () => pm.expect(pm.response.json().data.studyYear).to.eql('YEAR_3'));",
    examples: [
      example(
        "Set year - 200",
        "PUT",
        "/api/onboarding/year",
        200,
        "OK",
        {
          success: true,
          message: "Study year saved",
          data: { studyYear: "YEAR_3", currentStep: "SUBJECTS" },
        }
      ),
    ],
  }),
  req("PUT /api/onboarding/subjects", "PUT", "/api/onboarding/subjects", {
    desc:
      "Step 3 - save the subjects the student is most confident in.\n\n" +
      "- `subjectIds`: 1-10 active subject ids (from GET /options).\n" +
      "- Replaces the student's previous selection.\n" +
      "- Unknown or inactive ids return 400; nothing is saved.\n" +
      "- Response includes the new `currentStep` (COMPLETE once all steps are set).\n\n" +
      "Requires a STUDENT Bearer token.\n\n" +
      "Responses: 200 | 400 (validation / invalid ids) | 401 | 403 | 404.",
    auth: true,
    body: { subjectIds: ["{{subjectId1}}", "{{subjectId2}}"] },
    test:
      "pm.test('status is 200', () => pm.response.to.have.status(200));\n" +
      "pm.test('returns selected subjects', () => pm.expect(pm.response.json().data.subjects.length).to.be.above(0));",
    examples: [
      example(
        "Set subjects - 200",
        "PUT",
        "/api/onboarding/subjects",
        200,
        "OK",
        {
          success: true,
          message: "Subject selection saved",
          data: {
            subjects: [
              { id: "sub_biology", name: "Biology", code: "BIO" },
              { id: "sub_chemistry", name: "Chemistry", code: "CHEM" },
            ],
            currentStep: "COMPLETE",
          },
        }
      ),
    ],
  }),
  req("POST /api/onboarding/complete", "POST", "/api/onboarding/complete", {
    desc:
      "Finish screen - marks onboarding complete.\n\n" +
      "- Requires exam, year, AND subjects to all be set first; otherwise 400\n" +
      "  listing what is missing, e.g. 'missing exam, studyYear, subjects'.\n" +
      "- `onboardingComplete` = the wizard is done; `profileComplete` reflects the\n" +
      "  fuller profile requirements (class level, gender, DOB, ...) and may still\n" +
      "  be false.\n\n" +
      "Requires a STUDENT Bearer token.\n\n" +
      "Responses: 200 | 400 (steps missing) | 401 | 403 | 404.",
    auth: true,
    test:
      "pm.test('status is 200', () => pm.response.to.have.status(200));\n" +
      "pm.test('onboarding is complete', () => pm.expect(pm.response.json().data.onboardingComplete).to.eql(true));",
    examples: [
      example(
        "Complete - 200",
        "POST",
        "/api/onboarding/complete",
        200,
        "OK",
        {
          success: true,
          message: "Onboarding completed",
          data: { onboardingComplete: true, profileComplete: false },
        }
      ),
      example(
        "Complete too early - 400",
        "POST",
        "/api/onboarding/complete",
        400,
        "Bad Request",
        {
          success: false,
          message: "Onboarding cannot be completed yet: missing exam, studyYear, subjects",
        }
      ),
    ],
  })
);

collection.item.push({ name: "Onboarding", item: onboardingItems });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(collection, null, 2) + "\n", "utf8");
console.log("Wrote " + outPath);