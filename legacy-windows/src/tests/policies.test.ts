/**
 * The renewal chain and the status sweep, ported from the Rust tests of the same
 * names: `renewal_builds_a_chain_and_preserves_history`,
 * `statuses_follow_the_calendar`, `a_cancelled_policy_is_left_alone_by_the_sweep`,
 * `renewing_a_cancelled_year_leaves_it_cancelled`,
 * `an_expiry_moved_forward_brings_a_policy_back`,
 * `editing_a_policy_leaves_its_place_in_the_chain_alone`,
 * `a_policy_renumbered_or_filled_in_is_still_the_one_the_lists_find`,
 * `a_chain_keeps_exactly_one_open_year`, `deleting_a_year_leaves_the_earlier_ones_standing`,
 * `duplicate_policy_number_for_same_insurer_is_rejected`,
 * `two_insurers_may_each_use_the_same_policy_number`,
 * `only_the_statuses_the_app_knows_are_accepted` and
 * `members_attach_only_to_their_own_client`.
 *
 * The motor cases keep the Rust names verbatim rather than reading as prose,
 * because a vehicle recorded differently in the two editions is the drift nothing
 * else can see: `a_motor_policy_keeps_the_vehicle_its_cover_was_written_on`,
 * `the_motor_details_are_held_to_the_words_the_app_knows`,
 * `a_standalone_own_damage_policy_holds_no_third_party_cover`,
 * `a_liability_policy_holds_no_own_damage_cover`,
 * `the_weight_and_the_seats_belong_to_the_vehicle_that_has_them`,
 * `half_a_risk_period_is_not_a_risk_period`,
 * `a_motor_policy_expires_when_its_first_cover_does`,
 * `a_motor_policy_with_no_risk_dates_keeps_the_dates_it_was_given`,
 * `a_policy_can_be_found_by_its_engine_or_chassis_number`,
 * `a_renewed_motor_policy_keeps_the_vehicle_and_restates_the_risk`,
 * `a_vehicle_older_than_the_motor_car_is_a_typo` and
 * `no_cover_type_means_neither_half_however_it_is_written`.
 *
 * This is the file worth having. Everything else in the port either works or
 * throws; these rules can be subtly wrong and stay quiet for a year, until a
 * renewal that should have been on the desk was not, and the client's cover
 * lapsed. The Rust suite is the specification and these are the same cases.
 */

import * as clients from "../core/repo/clients";
import * as dashboard from "../core/repo/dashboard";
import * as insurers from "../core/repo/insurers";
import * as relations from "../core/repo/relations";
import * as policies from "../core/repo/policies";
import type { Policy, PolicyInput } from "../core/types";
import { COVER_TYPES, coverHasOwnDamage, coverHasThirdParty } from "../core/util";
import { expect, suite, test, throwsKind } from "./harness";
import { daysFromToday, sampleClient, samplePolicy, tempDb } from "./support";

suite("the health details a proposal is written on", () => {
  // Ported from `a_health_policy_keeps_the_detail_its_proposal_was_written_on`.
  test("are stored as chosen, handed back as a list, and carried into next year", () => {
    const db = tempDb("health-details");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Rohit Sharma"));
      const insurer = insurers.findOrCreate(conn, "Star Health");

      const id = policies.create(conn, {
        ...samplePolicy(client, insurer, "HS/2026/001", "2029-03-31"),
        variant: "Gold",
        // Clicked in this order, which is not the insurer's.
        riders: ["future_ready", "safeguard"],
        planType: "family_floater",
        term: 3,
        policyType: "portability",
        broker: "Deshmukh Insurance Services",
        inbuiltRider: "Road ambulance cover",
      });

      const policy = policies.get(conn, id);
      expect.deepEqual(
        policy.riders,
        ["safeguard", "future_ready"],
        "riders come back in the insurer's order, not the order of clicking",
      );
      expect.equal(policy.variant, "Gold");
      expect.equal(policy.term, 3);

      const next = policies.renew(conn, { policyId: id, policyNumber: "HS/2029/002" });
      const renewed = policies.get(conn, next);

      expect.equal(
        renewed.expiryDate,
        "2032-03-31",
        "three years were bought, so three years are renewed",
      );
      expect.deepEqual(renewed.riders, policy.riders, "the riders come along");
      expect.equal(renewed.policyType, "renewal", "a ported year renews into a renewal");
    });
    db.close();
  });

  // No Rust counterpart, and that is the point: `dashboard.rs` reads through the
  // same `POLICY_COLUMNS` the lists do, so it cannot fall behind them. Here the
  // dashboard has its own query, and a column added to one and not the other
  // would hand this screen a policy with the health answers missing.
  test("reach the dashboard the way they reach every other list", () => {
    const db = tempDb("health-dashboard");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Meera Iyer"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      policies.create(conn, {
        ...samplePolicy(client, insurer, "HS/2026/020", daysFromToday(20)),
        variant: "Platinum",
        riders: ["safeguard"],
        planType: "individual",
      });

      const [upcoming] = dashboard.load(conn).upcoming;
      expect.equal(upcoming?.variant, "Platinum");
      expect.deepEqual(upcoming?.riders, ["safeguard"]);
      expect.equal(upcoming?.planType, "individual");
    });
    db.close();
  });

  // Ported from `the_health_details_are_held_to_the_words_the_app_knows`.
  test("are held to the words the app knows, but not required to be there", async () => {
    const db = tempDb("health-words");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Rohit Sharma"));
      const insurer = insurers.findOrCreate(conn, "Star Health");

      const spoilers: [string, Partial<Parameters<typeof policies.create>[1]>][] = [
        ["HS/2026/010", { planType: "floater" }],
        ["HS/2026/011", { policyType: "port" }],
        ["HS/2026/012", { riders: ["gold_cover"] }],
        ["HS/2026/013", { term: 9 }],
      ];
      for (const [number, spoiled] of spoilers) {
        await throwsKind(
          "validation",
          () =>
            policies.create(conn, {
              ...samplePolicy(client, insurer, number, "2027-03-31"),
              ...spoiled,
            }),
          `${number} should have been refused`,
        );
      }

      // A book that predates the questions still goes in: the screen asks for
      // these, the core does not.
      const plain = policies.create(
        conn,
        samplePolicy(client, insurer, "HS/2026/014", "2027-03-31"),
      );
      expect.deepEqual(policies.get(conn, plain).riders, []);
      expect.equal(policies.get(conn, plain).planType, null);
    });
    db.close();
  });
});

/** A motor proposal, before any of the vehicle is filled in. */
function motorPolicy(
  clientId: number,
  insurerId: number,
  number: string,
  expiry: string,
): PolicyInput {
  return { ...samplePolicy(clientId, insurerId, number, expiry), category: "motor" };
}

/** The fifteen the migration added, named so a policy can be read for all of them. */
const MOTOR_FIELDS = [
  "vehicleType",
  "grossVehicleWeight",
  "passengerCapacity",
  "vehicleManufacturer",
  "vehicleModel",
  "manufactureYear",
  "engineNumber",
  "chassisNumber",
  "coverType",
  "odStartDate",
  "odEndDate",
  "tpStartDate",
  "tpEndDate",
  "odPremium",
  "tpPremium",
] as const satisfies readonly (keyof Policy)[];

suite("the vehicle a motor policy is written on", () => {
  test("a_motor_policy_keeps_the_vehicle_its_cover_was_written_on", () => {
    const db = tempDb("motor-vehicle");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Rakesh Pawar"));
      const insurer = insurers.findOrCreate(conn, "ICICI Lombard");

      const id = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/001", "2027-03-31"),
        vehicleType: "goods_carrying",
        grossVehicleWeight: 7_500,
        // Answered on the form of a vehicle that has no seats to sell, so R4
        // drops it: the fifteen are all sent and fourteen are what a goods
        // carrying vehicle has.
        passengerCapacity: 42,
        vehicleManufacturer: "Tata Motors",
        vehicleModel: "Tata Ace Gold",
        manufactureYear: 2024,
        engineNumber: " 275ide2b7112345 ",
        chassisNumber: "mat445123pk56789",
        coverType: "package",
        odStartDate: "2026-04-01",
        odEndDate: "2027-03-31",
        tpStartDate: "2026-04-01",
        tpEndDate: "2027-03-31",
        odPremium: 18_400,
        tpPremium: 6_100,
      });

      const policy = policies.get(conn, id);
      expect.equal(policy.vehicleType, "goods_carrying");
      expect.equal(policy.grossVehicleWeight, 7_500);
      expect.equal(policy.passengerCapacity, null, "seats belong to a passenger vehicle");
      expect.equal(policy.vehicleManufacturer, "Tata Motors");
      expect.equal(policy.vehicleModel, "Tata Ace Gold");
      expect.equal(policy.manufactureYear, 2024);
      expect.equal(
        policy.engineNumber,
        "275IDE2B7112345",
        "the number stamped on the engine is stamped in capitals",
      );
      expect.equal(policy.chassisNumber, "MAT445123PK56789");
      expect.equal(policy.coverType, "package");
      expect.equal(policy.odStartDate, "2026-04-01");
      expect.equal(policy.odEndDate, "2027-03-31");
      expect.equal(policy.tpStartDate, "2026-04-01");
      expect.equal(policy.tpEndDate, "2027-03-31");
      expect.equal(policy.odPremium, 18_400);
      expect.equal(policy.tpPremium, 6_100);

      // A proposal that names none of the fifteen leaves all fifteen empty, and
      // is in every other way the policy it would have been before the questions
      // existed — which is the state every imported row is in.
      const bare = policies.get(
        conn,
        policies.create(conn, motorPolicy(client, insurer, "MT/2026/002", "2027-03-31")),
      );
      for (const field of MOTOR_FIELDS) {
        expect.equal(bare[field], null, `${field} was never answered, so it holds nothing`);
      }
      expect.equal(bare.policyNumber, "MT/2026/002");
      expect.equal(bare.category, "motor");
      expect.equal(bare.startDate, "2026-04-01", "the dates it was given stand");
      expect.equal(bare.expiryDate, "2027-03-31");
      expect.equal(bare.sumInsured, 1_000_000);
      expect.equal(bare.premiumAmount, 24_500);
      expect.equal(bare.commissionRate, 15);
      expect.equal(bare.status, "active");
    });
    db.close();
  });

  test("the_motor_details_are_held_to_the_words_the_app_knows", async () => {
    const db = tempDb("motor-words");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Sunil Deshpande"));
      const insurer = insurers.findOrCreate(conn, "Bajaj Allianz");

      // The wording is asserted, not just the kind. A refusal an operator reads
      // is the part of a port that can drift without anything failing, and the
      // Rust case pins the same strings.
      const vehicle = await throwsKind(
        "validation",
        () =>
          policies.create(conn, {
            ...motorPolicy(client, insurer, "MT/2026/010", "2027-03-31"),
            vehicleType: "tractor",
          }),
        "a vehicle the app has no rating for is not a vehicle type",
      );
      expect.equal(vehicle.message, '"tractor" is not a known vehicle type');

      const cover = await throwsKind("validation", () =>
        policies.create(conn, {
          ...motorPolicy(client, insurer, "MT/2026/011", "2027-03-31"),
          coverType: "comprehensive",
        }),
      );
      expect.equal(cover.message, '"comprehensive" is not a known cover type');

      const shouted = await throwsKind(
        "validation",
        () =>
          policies.create(conn, {
            ...motorPolicy(client, insurer, "MT/2026/012", "2027-03-31"),
            vehicleType: "PVT_CAR",
          }),
        "the stored word is the stored word, not a word shouted",
      );
      expect.equal(shouted.message, '"PVT_CAR" is not a known vehicle type');

      // A book that predates the questions still goes in, and a blank is nothing
      // said rather than a word nobody knows.
      const plain = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/013", "2027-03-31"),
        vehicleType: "",
        coverType: "",
      });
      expect.equal(policies.get(conn, plain).vehicleType, null);
      expect.equal(policies.get(conn, plain).coverType, null);
    });
    db.close();
  });

  test("a_standalone_own_damage_policy_holds_no_third_party_cover", () => {
    const db = tempDb("motor-standalone-od");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Anita Kulkarni"));
      const insurer = insurers.findOrCreate(conn, "HDFC ERGO");

      const id = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/020", "2027-03-31"),
        vehicleType: "pvt_car",
        coverType: "standalone_od",
        odStartDate: "2026-04-01",
        odEndDate: "2027-03-31",
        odPremium: 9_800,
        // Sent by an agent who filled the whole sheet in; the policy carries no
        // third party cover, so the book must not say it does.
        tpStartDate: "2026-04-01",
        tpEndDate: "2029-03-31",
        tpPremium: 5_400,
      });

      const policy = policies.get(conn, id);
      expect.equal(policy.tpStartDate, null);
      expect.equal(policy.tpEndDate, null);
      expect.equal(policy.tpPremium, null);
      expect.equal(policy.odStartDate, "2026-04-01");
      expect.equal(policy.odEndDate, "2027-03-31");
      expect.equal(policy.odPremium, 9_800);
    });
    db.close();
  });

  test("a_liability_policy_holds_no_own_damage_cover", () => {
    const db = tempDb("motor-liability");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Faisal Merchant"));
      const insurer = insurers.findOrCreate(conn, "United India");

      const id = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/021", "2027-03-31"),
        vehicleType: "two_wheeler",
        coverType: "liability",
        odStartDate: "2026-04-01",
        odEndDate: "2027-03-31",
        odPremium: 9_800,
        tpStartDate: "2026-04-01",
        tpEndDate: "2027-03-31",
        tpPremium: 1_450,
      });

      const policy = policies.get(conn, id);
      expect.equal(policy.odStartDate, null);
      expect.equal(policy.odEndDate, null);
      expect.equal(policy.odPremium, null);
      expect.equal(policy.tpStartDate, "2026-04-01");
      expect.equal(policy.tpEndDate, "2027-03-31");
      expect.equal(policy.tpPremium, 1_450);
    });
    db.close();
  });

  test("the_weight_and_the_seats_belong_to_the_vehicle_that_has_them", () => {
    const db = tempDb("motor-weight-seats");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Harpreet Singh"));
      const insurer = insurers.findOrCreate(conn, "New India Assurance");

      const goods = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/030", "2027-03-31"),
        vehicleType: "goods_carrying",
        grossVehicleWeight: 12_000,
      });
      expect.equal(policies.get(conn, goods).grossVehicleWeight, 12_000);

      // The same lorry, rewritten as a car by an edit: the weight goes with the
      // vehicle it described.
      policies.update(conn, goods, {
        ...motorPolicy(client, insurer, "MT/2026/030", "2027-03-31"),
        vehicleType: "pvt_car",
        grossVehicleWeight: 12_000,
      });
      expect.equal(policies.get(conn, goods).grossVehicleWeight, null);

      const bus = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/031", "2027-03-31"),
        vehicleType: "passenger",
        passengerCapacity: 45,
      });
      expect.equal(policies.get(conn, bus).passengerCapacity, 45);

      const scooter = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/032", "2027-03-31"),
        vehicleType: "two_wheeler",
        passengerCapacity: 45,
      });
      expect.equal(policies.get(conn, scooter).passengerCapacity, null);
    });
    db.close();
  });

  test("half_a_risk_period_is_not_a_risk_period", async () => {
    const db = tempDb("motor-half-period");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Jaya Menon"));
      const insurer = insurers.findOrCreate(conn, "Tata AIG");

      // Both refusals are quoted back to the agent by the form, so both are held
      // to their wording here and in the Rust case.
      const half = await throwsKind(
        "validation",
        () =>
          policies.create(conn, {
            ...motorPolicy(client, insurer, "MT/2026/040", "2027-03-31"),
            coverType: "package",
            odStartDate: "2026-04-01",
          }),
        "a cover that starts and never ends is a date typed into the wrong box",
      );
      expect.equal(half.message, "Both risk dates are needed for own damage cover");

      const backwards = await throwsKind("validation", () =>
        policies.create(conn, {
          ...motorPolicy(client, insurer, "MT/2026/041", "2027-03-31"),
          coverType: "package",
          odStartDate: "2027-03-31",
          odEndDate: "2026-04-01",
        }),
      );
      expect.equal(backwards.message, "The own damage cover must end after it starts");

      // The same half pair on a cover the policy does not carry is cleared before
      // anything is asked of it.
      const liability = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/042", "2027-03-31"),
        coverType: "liability",
        odStartDate: "2026-04-01",
        tpStartDate: "2026-04-01",
        tpEndDate: "2027-03-31",
      });
      expect.equal(policies.get(conn, liability).odStartDate, null);
    });
    db.close();
  });

  test("a_motor_policy_expires_when_its_first_cover_does", () => {
    const db = tempDb("motor-first-expiry");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Dinesh Bhat"));
      const insurer = insurers.findOrCreate(conn, "Reliance General");

      const id = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/050", "2029-03-31"),
        // Neither of the dates the caller sent survives: a 1+3 bundle is on the
        // renewals desk after one year, not after three.
        startDate: "2026-06-01",
        vehicleType: "pvt_car",
        coverType: "bundle_1_3",
        odStartDate: "2026-04-02",
        odEndDate: "2027-04-01",
        tpStartDate: "2026-04-01",
        tpEndDate: "2029-03-31",
      });

      const policy = policies.get(conn, id);
      expect.equal(policy.expiryDate, "2027-04-01", "the own damage cover lapses first");
      expect.equal(policy.startDate, "2026-04-01", "and the risk began when the earlier cover did");

      // Only a motor policy is rewritten this way. A health policy that arrived
      // carrying risk dates — an import that filled the wrong columns, or a
      // category corrected after the fact — keeps the year it was sold for.
      const health = policies.get(
        conn,
        policies.create(conn, {
          ...samplePolicy(client, insurer, "HS/2026/050", "2029-03-31"),
          startDate: "2026-06-01",
          coverType: "bundle_1_3",
          odStartDate: "2026-04-02",
          odEndDate: "2027-04-01",
          tpStartDate: "2026-04-01",
          tpEndDate: "2029-03-31",
        }),
      );
      expect.equal(health.category, "health");
      expect.equal(health.startDate, "2026-06-01", "the dates the caller sent stand");
      expect.equal(health.expiryDate, "2029-03-31");
      expect.equal(health.odEndDate, "2027-04-01", "though the dates themselves are stored");
    });
    db.close();
  });

  test("a_motor_policy_with_no_risk_dates_keeps_the_dates_it_was_given", () => {
    const db = tempDb("motor-no-risk-dates");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Pooja Rane"));
      const insurer = insurers.findOrCreate(conn, "SBI General");

      const id = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/051", "2029-03-31"),
        startDate: "2026-06-01",
        vehicleType: "pvt_car",
        coverType: "bundle_1_3",
      });

      const policy = policies.get(conn, id);
      expect.equal(policy.startDate, "2026-06-01");
      expect.equal(policy.expiryDate, "2029-03-31");
    });
    db.close();
  });

  test("a_policy_can_be_found_by_its_engine_or_chassis_number", () => {
    const db = tempDb("motor-search");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Manoj Tiwari"));
      const insurer = insurers.findOrCreate(conn, "Kotak General");
      policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/060", "2027-03-31"),
        engineNumber: "K9BN12345678",
        chassisNumber: "MA3ERLF1S00123456",
      });

      // A claim arrives quoting one number and nothing else, typed as it was read.
      const found = (search: string) => policies.list(conn, { search }).total;
      expect.equal(found("k9bn12345678"), 1, "the engine number, in the case it was typed");
      expect.equal(found("ma3erlf1s00123456"), 1, "and the chassis number");
      expect.equal(found("ERLF1S001"), 1, "part of one is enough, as it is for a policy number");
      expect.equal(found("K9BN99999999"), 0);
    });
    db.close();
  });

  test("a_renewed_motor_policy_keeps_the_vehicle_and_restates_the_risk", () => {
    const db = tempDb("motor-renew");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Shalini Rao"));
      const insurer = insurers.findOrCreate(conn, "Cholamandalam MS");

      const first = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/070", "2029-03-31"),
        vehicleType: "passenger",
        passengerCapacity: 45,
        vehicleManufacturer: "Ashok Leyland",
        vehicleModel: "Ashok Leyland Viking",
        manufactureYear: 2021,
        engineNumber: "ALV4567890",
        chassisNumber: "MB1PBAKC7MRJK1234",
        coverType: "bundle_1_3",
        odStartDate: "2026-04-01",
        odEndDate: "2027-03-31",
        odPremium: 41_000,
        tpStartDate: "2026-04-01",
        tpEndDate: "2029-03-31",
        tpPremium: 22_500,
      });
      expect.equal(policies.get(conn, first).expiryDate, "2027-03-31");

      const second = policies.renew(conn, { policyId: first, policyNumber: "MT/2027/071" });
      const renewed = policies.get(conn, second);

      expect.equal(renewed.vehicleType, "passenger", "the same bus is insured next year");
      expect.equal(renewed.passengerCapacity, 45);
      expect.equal(
        renewed.grossVehicleWeight,
        null,
        "and it is still a bus, so it still has no gross weight",
      );
      expect.equal(renewed.vehicleManufacturer, "Ashok Leyland");
      expect.equal(renewed.vehicleModel, "Ashok Leyland Viking");
      expect.equal(renewed.manufactureYear, 2021);
      expect.equal(renewed.engineNumber, "ALV4567890");
      expect.equal(renewed.chassisNumber, "MB1PBAKC7MRJK1234");
      expect.equal(renewed.coverType, "bundle_1_3");

      // The risk is restated rather than carried: last year's dates and split
      // premiums describe last year.
      expect.equal(renewed.odStartDate, null);
      expect.equal(renewed.odEndDate, null);
      expect.equal(renewed.tpStartDate, null);
      expect.equal(renewed.tpEndDate, null);
      expect.equal(renewed.odPremium, null);
      expect.equal(renewed.tpPremium, null);

      expect.equal(renewed.startDate, "2027-04-01", "the day after the year that lapsed first");
      expect.equal(renewed.expiryDate, "2028-03-31", "and a year of it, as any renewal gets");
    });
    db.close();
  });

  test("a_vehicle_older_than_the_motor_car_is_a_typo", async () => {
    const db = tempDb("motor-ranges");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Girish Kamat"));
      const insurer = insurers.findOrCreate(conn, "Future Generali");

      // Each of these would otherwise reach the schema's CHECK and come back as a
      // conflict quoting SQLite at an agent who mistyped a number. `throwsKind`
      // holds the kind and the wording holds what they are shown: neither says
      // anything about a constraint.
      const year = await throwsKind(
        "validation",
        () =>
          policies.create(conn, {
            ...motorPolicy(client, insurer, "MT/2026/080", "2027-03-31"),
            manufactureYear: 1899,
          }),
        "the motor car is younger than that, so the year is a typo",
      );
      expect.equal(year.message, "A manufacture year is between 1900 and 2100");

      const digit = await throwsKind("validation", () =>
        policies.create(conn, {
          ...motorPolicy(client, insurer, "MT/2026/081", "2027-03-31"),
          manufactureYear: 20_240,
        }),
      );
      expect.equal(digit.message, "A manufacture year is between 1900 and 2100");

      const weight = await throwsKind("validation", () =>
        policies.create(conn, {
          ...motorPolicy(client, insurer, "MT/2026/082", "2027-03-31"),
          vehicleType: "goods_carrying",
          grossVehicleWeight: 0,
        }),
      );
      expect.equal(weight.message, "A gross vehicle weight is more than nothing");

      const seats = await throwsKind("validation", () =>
        policies.create(conn, {
          ...motorPolicy(client, insurer, "MT/2026/083", "2027-03-31"),
          vehicleType: "passenger",
          passengerCapacity: 0,
        }),
      );
      expect.equal(seats.message, "A vehicle carries at least one passenger");

      // The bounds are inclusive, and nothing said is still allowed.
      const oldest = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/084", "2027-03-31"),
        vehicleType: "passenger",
        passengerCapacity: 1,
        manufactureYear: 1900,
      });
      expect.equal(policies.get(conn, oldest).manufactureYear, 1900);
      expect.equal(policies.get(conn, oldest).passengerCapacity, 1);

      // And the range is asked of the detail as it will be stored: a weight
      // sitting on a vehicle that has none is dropped by R4 before this looks,
      // because it is a stale answer on the form rather than a bad number.
      const car = policies.create(conn, {
        ...motorPolicy(client, insurer, "MT/2026/085", "2027-03-31"),
        vehicleType: "pvt_car",
        grossVehicleWeight: 0,
        passengerCapacity: 0,
      });
      expect.equal(policies.get(conn, car).grossVehicleWeight, null);
      expect.equal(policies.get(conn, car).passengerCapacity, null);
    });
    db.close();
  });

  test("no_cover_type_means_neither_half_however_it_is_written", () => {
    // The two helpers R3 and the form's R16 are both written in terms of, so the
    // core and the screen cannot disagree about which half a policy carries.
    expect.equal(coverHasOwnDamage(null), false, "nothing chosen carries neither half");
    expect.equal(coverHasThirdParty(null), false);
    expect.equal(coverHasOwnDamage(undefined), false);
    expect.equal(coverHasThirdParty(undefined), false);
    expect.equal(coverHasOwnDamage(""), false, "and a form that sent an empty box has not chosen");
    expect.equal(coverHasThirdParty(""), false);

    const carries: [cover: string, ownDamage: boolean, thirdParty: boolean][] = [
      ["bundle_1_3", true, true],
      ["bundle_3_3", true, true],
      ["standalone_od", true, false],
      ["package", true, true],
      ["liability", false, true],
    ];
    // So a sixth cover type cannot be added to the vocabulary without a line here
    // saying what it carries.
    expect.equal(carries.length, COVER_TYPES.length, "every cover type the app knows is answered");

    for (const [cover, ownDamage, thirdParty] of carries) {
      expect.ok(
        (COVER_TYPES as readonly string[]).includes(cover),
        `${cover} should be one of the words the app stores`,
      );
      expect.equal(coverHasOwnDamage(cover), ownDamage, `${cover} and own damage`);
      expect.equal(coverHasThirdParty(cover), thirdParty, `${cover} and third party`);
    }

    // Neither helper trims, on either side of the port, and the repositories
    // blank-to-null before asking. A string of spaces is a word nobody stores, so
    // what it answers is only recorded here rather than relied on.
    expect.equal(coverHasOwnDamage("   "), true);
    expect.equal(coverHasThirdParty("   "), true);
  });
});

suite("renewal", () => {
  test("builds a chain and preserves history", () => {
    const db = tempDb("renew");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Rohit Sharma"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const first = policies.create(conn, samplePolicy(client, insurer, "HS/2026/001", "2027-03-31"));

      const second = policies.renew(conn, {
        policyId: first,
        policyNumber: "HS/2027/002",
        sumInsured: 1_500_000,
        premiumAmount: 27_000,
        notes: "Cover increased",
      });

      const old = policies.get(conn, first);
      const created = policies.get(conn, second);

      expect.equal(old.status, "renewed");
      expect.equal(old.premiumAmount, 24_500, "last year's premium must survive");
      expect.ok(old.isRenewed);

      expect.equal(created.policyYear, 2);
      expect.equal(created.previousPolicyId, first);
      expect.equal(created.chainId, old.chainId);
      expect.equal(created.startDate, "2027-04-01", "starts the day after expiry");
      expect.equal(created.expiryDate, "2028-03-31", "runs a year minus a day");
      expect.equal(created.sumInsured, 1_500_000);
      // Carried forward because the renewal did not restate it.
      expect.equal(created.commissionRate, 15);

      const chain = policies.chain(conn, second);
      expect.equal(chain.length, 2);
      expect.equal(chain[0]!.policyYear, 1, "oldest year first");

      const latest = policies.list(conn, { latestOnly: true });
      expect.equal(latest.total, 1, "the latest year is the one without a successor");
      expect.equal(latest.rows[0]!.id, second);
    });
    db.close();
  });

  test("keeps exactly one open year, whatever is asked of it", async () => {
    const db = tempDb("one-open-year");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Nikhil Joshi"));
      const insurer = insurers.findOrCreate(conn, "Care Health");
      const first = policies.create(conn, samplePolicy(client, insurer, "O-1", "2027-03-31"));
      const second = policies.renew(conn, { policyId: first, policyNumber: "O-2" });

      await throwsKind(
        "conflict",
        () => policies.renew(conn, { policyId: first, policyNumber: "O-3" }),
        "a year that has been renewed cannot be renewed again into a forked chain",
      );

      const chain = policies.chain(conn, second);
      expect.equal(chain.filter((policy) => !policy.isRenewed).length, 1);
    });
    db.close();
  });

  test("leaves a cancelled year saying so", async () => {
    const db = tempDb("renew-cancelled");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Imran Qureshi"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const first = policies.create(conn, samplePolicy(client, insurer, "C-1", "2027-03-31"));
      policies.setStatus(conn, first, "cancelled");

      // The client came back and took cover again for the following year.
      const second = policies.renew(conn, { policyId: first, policyNumber: "C-2" });

      const cancelled = policies.get(conn, first);
      expect.equal(cancelled.status, "cancelled", "the book still says the cover was ended early");
      expect.ok(
        cancelled.isRenewed,
        "and still knows a later year replaced it, which is what keeps it off the renewals desk",
      );

      // The sweep must not talk it round either way.
      policies.syncStatuses(conn);
      expect.equal(policies.get(conn, first).status, "cancelled");

      const chain = policies.chain(conn, second);
      expect.equal(chain.filter((policy) => !policy.isRenewed).length, 1, "one open year, as in any chain");
    });
    db.close();
  });

  test("carries the members forward to the new year", () => {
    const db = tempDb("renew-members");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Sunita Nair"));
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");
      const spouse = clients.create(conn, sampleClient("Ravi Nair"));
      relations.link(conn, {
        clientId: client,
        relatedClientId: spouse,
        relationship: "spouse",
      });
      const policy = policies.create(conn, {
        ...samplePolicy(client, insurer, "M-1", "2027-03-31"),
        insuredClientIds: [spouse],
      });

      const second = policies.renew(conn, { policyId: policy, policyNumber: "M-2" });
      expect.deepEqual(policies.insuredOf(conn, second), [spouse]);
    });
    db.close();
  });

  test("leaves an edited year in its place in the chain", () => {
    const db = tempDb("edit");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Kabir Malhotra"));
      const insurer = insurers.findOrCreate(conn, "ICICI Lombard");
      const first = policies.create(conn, samplePolicy(client, insurer, "E-1", "2027-03-31"));
      const second = policies.renew(conn, { policyId: first, policyNumber: "E-2" });

      const before = policies.get(conn, second);
      policies.update(conn, second, {
        ...samplePolicy(client, insurer, "E-2-corrected", "2028-03-31"),
        startDate: before.startDate,
      });

      const after = policies.get(conn, second);
      expect.equal(after.policyNumber, "E-2-corrected");
      expect.equal(after.policyYear, before.policyYear, "still the second year");
      expect.equal(after.previousPolicyId, first, "and still behind the first");
      expect.equal(after.chainId, before.chainId);
      expect.equal(policies.chain(conn, second).length, 2);
    });
    db.close();
  });

  test("is still the one the lists find after it is renumbered", () => {
    // Ported from `a_policy_renumbered_or_filled_in_is_still_the_one_the_lists_find`.
    // `policies_touch` nests an update the way `clients_touch` does, so it is worth
    // saying where the difference is: there is no search index on policies for it
    // to disturb, policy search being a LIKE over policy_overview. What this holds
    // is that, and the client index surviving a policy edited beside it.
    const db = tempDb("policy-edit-search");
    db.with((conn) => {
      const client = clients.create(conn, { fullName: "Ravi Bose" });
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const id = policies.create(conn, samplePolicy(client, insurer, "SH/2026/1", "2027-03-31"));

      policies.update(conn, id, {
        ...samplePolicy(client, insurer, "SH/2026/1-A", "2027-03-31"),
        vehicleNumber: "MH 12 AB 3456",
      });

      const found = (search: string) => policies.list(conn, { search }).total;
      expect.equal(policies.get(conn, id).policyNumber, "SH/2026/1-A");
      expect.equal(found("SH/2026/1-A"), 1, "the number it now carries");
      expect.equal(found("MH 12 AB 3456"), 1, "and the vehicle just recorded");

      // The lists read the client's name through the view, so a rename has to
      // bring the policy with it.
      clients.update(conn, client, {
        fullName: "Ravi Kumar Sharma",
        email: "ravi@example.com",
        pan: "abcde1234f",
      });
      expect.equal(found("Sharma"), 1);
      expect.equal(found("Bose"), 0);
      expect.equal(clients.list(conn, { search: "Sharma" }).total, 1);
      conn.exec("INSERT INTO clients_fts(clients_fts) VALUES('integrity-check')");
    });
    db.close();
  });

  test("leaves the earlier years standing when a year is deleted", () => {
    const db = tempDb("delete-year");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Leela Menon"));
      const insurer = insurers.findOrCreate(conn, "Tata AIG");
      const first = policies.create(conn, samplePolicy(client, insurer, "D-1", "2027-03-31"));
      const second = policies.renew(conn, { policyId: first, policyNumber: "D-2" });

      policies.remove(conn, second);

      const remaining = policies.get(conn, first);
      expect.ok(!remaining.isRenewed, "with the successor gone it is the open year again");
      policies.syncStatuses(conn);
      expect.equal(
        policies.get(conn, first).status,
        "active",
        "and the sweep puts back the status the renewal took",
      );
    });
    db.close();
  });
});

suite("statuses follow the calendar", () => {
  test("names each policy by where its expiry falls", () => {
    const db = tempDb("status");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Vikram Rao"));
      const insurer = insurers.findOrCreate(conn, "HDFC ERGO");

      const lapsed = policies.create(conn, {
        ...samplePolicy(client, insurer, "A-1", daysFromToday(-90)),
        startDate: daysFromToday(-455),
      });
      const expired = policies.create(conn, {
        ...samplePolicy(client, insurer, "A-2", daysFromToday(-5)),
        startDate: daysFromToday(-370),
      });
      const active = policies.create(conn, samplePolicy(client, insurer, "A-3", daysFromToday(120)));

      policies.syncStatuses(conn);

      expect.equal(policies.get(conn, lapsed).status, "lapsed");
      expect.equal(policies.get(conn, expired).status, "expired");
      expect.equal(policies.get(conn, active).status, "active");

      const summary = dashboard.load(conn);
      expect.equal(summary.expiredUnrenewed, 2);
      expect.equal(summary.activePolicies, 1);
      expect.ok(
        summary.buckets.some((bucket) => bucket.label === "Overdue" && bucket.count === 2),
        "and the dashboard counts them where the desk looks",
      );
    });
    db.close();
  });

  test("holds the grace period exactly where the Rust core holds it", () => {
    const db = tempDb("grace");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Deepa Krishnan"));
      const insurer = insurers.findOrCreate(conn, "SBI General");

      // Thirty days is still within grace; thirty-one is not. Getting this off by
      // one moves a client between two screens.
      const inside = policies.create(conn, {
        ...samplePolicy(client, insurer, "G-30", daysFromToday(-30)),
        startDate: daysFromToday(-395),
      });
      const outside = policies.create(conn, {
        ...samplePolicy(client, insurer, "G-31", daysFromToday(-31)),
        startDate: daysFromToday(-396),
      });

      policies.syncStatuses(conn);

      expect.equal(policies.get(conn, inside).status, "expired", "thirty days is still in grace");
      expect.equal(policies.get(conn, outside).status, "lapsed", "thirty-one is not");
    });
    db.close();
  });

  test("expires nothing on its last day", () => {
    const db = tempDb("last-day");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Arjun Pillai"));
      const insurer = insurers.findOrCreate(conn, "Reliance General");
      const today = policies.create(conn, {
        ...samplePolicy(client, insurer, "T-0", daysFromToday(0)),
        startDate: daysFromToday(-365),
      });

      policies.syncStatuses(conn);
      expect.equal(
        policies.get(conn, today).status,
        "active",
        "cover that runs until today is cover the client still has",
      );
    });
    db.close();
  });

  test("leaves a cancelled policy alone in either direction", () => {
    const db = tempDb("cancelled");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Farah Sheikh"));
      const insurer = insurers.findOrCreate(conn, "HDFC ERGO");

      const longGone = policies.create(conn, {
        ...samplePolicy(client, insurer, "X-1", daysFromToday(-90)),
        startDate: daysFromToday(-455),
      });
      const current = policies.create(conn, samplePolicy(client, insurer, "X-2", daysFromToday(120)));

      policies.setStatus(conn, longGone, "cancelled");
      policies.setStatus(conn, current, "cancelled");
      policies.syncStatuses(conn);

      // Cancelling is a decision somebody made; the calendar does not overrule it.
      expect.equal(policies.get(conn, longGone).status, "cancelled");
      expect.equal(policies.get(conn, current).status, "cancelled");
      expect.equal(dashboard.load(conn).activePolicies, 0);
    });
    db.close();
  });

  test("brings a policy back when its expiry is corrected", () => {
    const db = tempDb("revive");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Tara Menon"));
      const insurer = insurers.findOrCreate(conn, "Bajaj Allianz");
      const start = daysFromToday(-370);
      const id = policies.create(conn, {
        ...samplePolicy(client, insurer, "R-1", daysFromToday(-5)),
        startDate: start,
      });

      policies.syncStatuses(conn);
      expect.equal(policies.get(conn, id).status, "expired");

      // The date was typed wrong and has been corrected.
      policies.update(conn, id, {
        ...samplePolicy(client, insurer, "R-1", daysFromToday(120)),
        startDate: start,
      });
      expect.equal(
        policies.get(conn, id).status,
        "expired",
        "an edit that says nothing about status does not decide one",
      );

      policies.syncStatuses(conn);
      expect.equal(
        policies.get(conn, id).status,
        "active",
        "the sweep reads the corrected date and puts it back",
      );
    });
    db.close();
  });

  test("reports how much it changed, so a sweep that does nothing says so", () => {
    const db = tempDb("sweep-count");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Yusuf Khan"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      policies.create(conn, {
        ...samplePolicy(client, insurer, "S-1", daysFromToday(-5)),
        startDate: daysFromToday(-370),
      });

      expect.equal(policies.syncStatuses(conn), 1);
      expect.equal(policies.syncStatuses(conn), 0, "and running it twice changes nothing");
    });
    db.close();
  });
});

suite("policy numbers and statuses", () => {
  test("refuses the same number twice for one insurer", async () => {
    const db = tempDb("dupe");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Meera Iyer"));
      const insurer = insurers.findOrCreate(conn, "Care Health");
      policies.create(conn, samplePolicy(client, insurer, "SAME-1", "2027-01-01"));

      const error = await throwsKind("conflict", () =>
        policies.create(conn, samplePolicy(client, insurer, "SAME-1", "2028-01-01")),
      );
      expect.ok(
        error.message.includes("Use Renew"),
        "and says what to do instead, because this is how a renewal gets typed by hand",
      );
    });
    db.close();
  });

  test("lets two insurers each use the same number", () => {
    const db = tempDb("number-scope");
    db.with((conn) => {
      const client = clients.create(conn, sampleClient("Ishaan Bose"));
      const star = insurers.findOrCreate(conn, "Star Health");
      const care = insurers.findOrCreate(conn, "Care Health");
      expect.notEqual(star, care);

      policies.create(conn, samplePolicy(client, star, "POL-7", "2027-03-31"));
      policies.create(conn, samplePolicy(client, care, "POL-7", "2027-03-31"));
      expect.equal(policies.list(conn, { search: "POL-7" }).total, 2);
    });
    db.close();
  });

  test("accepts only the statuses the app knows", async () => {
    const db = tempDb("statuses");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Priya Shah"));
      const insurer = insurers.findOrCreate(conn, "Star Health");
      const id = policies.create(conn, samplePolicy(client, insurer, "ST-1", "2027-03-31"));

      for (const status of policies.STATUSES) {
        policies.setStatus(conn, id, status);
        expect.equal(policies.get(conn, id).status, status);
      }

      await throwsKind("validation", () => policies.setStatus(conn, id, "pending"));
      await throwsKind("not_found", () => policies.setStatus(conn, 9_999, "active"));
    });
    db.close();
  });

  test("refuses a policy the calendar could not make sense of", async () => {
    const db = tempDb("policy-validation");
    await db.with(async (conn) => {
      const client = clients.create(conn, sampleClient("Ganesh Iyer"));
      const insurer = insurers.findOrCreate(conn, "Star Health");

      await throwsKind("validation", () =>
        policies.create(conn, { ...samplePolicy(client, insurer, "", "2027-03-31") }),
      );
      await throwsKind("validation", () =>
        policies.create(conn, {
          ...samplePolicy(client, insurer, "V-1", "2027-03-31"),
          category: "spaceship",
        }),
      );
      await throwsKind(
        "validation",
        () => policies.create(conn, samplePolicy(client, insurer, "V-2", "2026-03-31")),
        "an expiry before the start is not a policy",
      );
      await throwsKind("validation", () =>
        policies.create(conn, { ...samplePolicy(client, insurer, "V-3", "not a date") }),
      );
      await throwsKind(
        "validation",
        () => policies.create(conn, samplePolicy(9_999, insurer, "V-4", "2027-03-31")),
        "and a policy needs a client that exists",
      );
    });
    db.close();
  });
});

suite("the lives a policy covers", () => {
  test("are its holder or someone related to them", () => {
    const db = tempDb("members");
    db.with((conn) => {
      const owner = clients.create(conn, sampleClient("Anil Kapoor"));
      const stranger = clients.create(conn, sampleClient("Sneha Reddy"));
      const insurer = insurers.findOrCreate(conn, "Niva Bupa");
      const policy = policies.create(conn, samplePolicy(owner, insurer, "MB-1", "2027-03-31"));

      const mine = relations.findOrCreateRelative(conn, owner, "Sonam Kapoor", "daughter");
      const theirs = relations.findOrCreateRelative(conn, stranger, "Rahul Reddy", "son");

      // The holder themselves, the daughter, and somebody from another family.
      policies.setMembers(conn, policy, [owner, mine, theirs]);

      expect.deepEqual(
        policies.insuredOf(conn, policy),
        [owner, mine].sort((a, b) => a - b),
        "the holder and his own family, and nobody else's",
      );

      const listed = relations.listForClient(conn, owner);
      expect.equal(listed.length, 1);
      expect.equal(listed[0]?.relationship, "daughter");
      expect.ok(
        listed[0]?.ownPolicies === 0 && listed[0]?.clientCode.startsWith("CL-"),
        "a life named on a policy became a client with a code of her own",
      );
    });
    db.close();
  });
});
