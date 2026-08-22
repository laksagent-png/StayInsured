/**
 * Writes the sample book used to exercise the app by hand.
 *
 * Every expiry is an offset from the day the script runs, so the renewals tabs,
 * the dashboard buckets and the reminder ladder always have something sitting
 * exactly on their boundaries. Re-run it whenever the files go stale:
 *
 *   npm run sample:data            # dates relative to today
 *   npm run sample:data -- --today=2026-12-01
 *
 * The generated README states the counts each screen should show; they are
 * derived from the same data, so the two cannot drift apart.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), "sample-data");
const DAY = 86_400_000;

const todayArg = process.argv.find((a) => a.startsWith("--today="));
const TODAY = todayArg ? new Date(`${todayArg.slice(8)}T00:00:00Z`) : startOfDay(new Date());

function startOfDay(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** ISO date `offset` days from today. */
function iso(offset) {
  return new Date(TODAY.getTime() + offset * DAY).toISOString().slice(0, 10);
}

/** The same date the way an Indian agency types it. */
function dmy(offset) {
  const [y, m, d] = iso(offset).split("-");
  return `${d}/${m}/${y}`;
}

/** Excel's day count from 1899-12-30, which is what a real .xlsx stores. */
function serial(offset) {
  return Math.round((new Date(TODAY.getTime() + offset * DAY) - Date.UTC(1899, 11, 30)) / DAY);
}

// ---------------------------------------------------------------- the book --

const clients = [
  { code: "CL-00001", name: "Rohit Sharma", email: "rohit.sharma@example.com", phone: "98765 43210", alt: "020 2567 8899", dob: "12/04/1986", gender: "Male", addr: "Flat 402, Green Meadows", addr2: "Baner Road", city: "Pune", state: "Maharashtra", pin: "411045", job: "Software engineer", pan: "ABCPS1234F" },
  { code: "CL-00002", name: "Anita Desai", email: "anita.desai@example.com", phone: "98200 11223", dob: "02/11/1979", gender: "Female", addr: "12 Sunder Villa", addr2: "Koregaon Park", city: "Pune", state: "Maharashtra", pin: "411001", job: "Architect", pan: "AKDPD9911K" },
  { code: "CL-00003", name: "Vikram Patel", email: "", phone: "99250 44556", dob: "23/01/1974", gender: "Male", addr: "Shop 7, Satellite Plaza", city: "Ahmedabad", state: "Gujarat", pin: "380015", job: "Trader", pan: "" },
  { code: "CL-00004", name: "Meera Iyer", email: "meera.iyer@example.com", phone: "98450 77889", dob: "30/06/1990", gender: "Female", addr: "301, Indiranagar Heights", city: "Bengaluru", state: "Karnataka", pin: "560038", job: "Consultant", pan: "AMFPI7788Q" },
  { code: "CL-00005", name: "Suresh Nair", email: "suresh.nair@example.com", phone: "94470 33221", dob: "14/09/1983", gender: "Male", addr: "Panampilly Nagar", city: "Kochi", state: "Kerala", pin: "682016", job: "Merchant navy", pan: "ASNPN2211R" },
  { code: "CL-00006", name: "Priya Menon", email: "priya.menon@example.com", phone: "98400 66554", dob: "08/02/1988", gender: "Female", addr: "18 Adyar Gardens", city: "Chennai", state: "Tamil Nadu", pin: "600020", job: "Doctor", pan: "APMPM6655T" },
  { code: "CL-00007", name: "Arjun Reddy", email: "arjun.reddy@example.com", phone: "90000 12345", dob: "19/12/1981", gender: "Male", addr: "Road No. 12, Banjara Hills", city: "Hyderabad", state: "Telangana", pin: "500034", job: "Restaurateur", pan: "AARPR1234N" },
  { code: "CL-00008", name: "Kavita Joshi", email: "kavita.joshi@example.com", phone: "97660 98765", dob: "25/07/1992", gender: "Female", addr: "Sai Residency, College Road", city: "Nashik", state: "Maharashtra", pin: "422005", job: "Teacher", pan: "AKJPJ9876L" },
  { code: "CL-00009", name: "Farhan Qureshi", email: "farhan.qureshi@example.com", phone: "98330 12121", dob: "03/03/1977", gender: "Male", addr: "22B Park Street", city: "Kolkata", state: "West Bengal", pin: "700016", job: "Exporter", pan: "AFQPQ1212B" },
  { code: "CL-00010", name: "Deepa Rao", email: "", phone: "90080 23456", dob: "11/11/1985", gender: "Female", addr: "44 Jayanagar 4th Block", city: "Bengaluru", state: "Karnataka", pin: "560011", job: "Dentist", pan: "ADRPR2345C" },
  { code: "CL-00011", name: "Sandeep Kulkarni", email: "sandeep.kulkarni@example.com", phone: "98220 34567", dob: "27/05/1980", gender: "Male", addr: "9 Shivaji Housing Society", city: "Pune", state: "Maharashtra", pin: "411016", job: "Contractor", pan: "ASKPK3456D" },
  { code: "CL-00012", name: "Ritu Bansal", email: "ritu.bansal@example.com", phone: "98110 45678", dob: "06/08/1993", gender: "Female", addr: "C-14 Vasant Kunj", city: "New Delhi", state: "Delhi", pin: "110070", job: "Product manager", pan: "ARBPB4567E" },
  { code: "CL-00013", name: "Manish Agarwal", email: "manish.agarwal@example.com", phone: "94140 56789", dob: "17/02/1971", gender: "Male", addr: "Haldiyon Ka Rasta", addr2: "Johari Bazaar", city: "Jaipur", state: "Rajasthan", pin: "302003", job: "Jeweller", pan: "AMAPA5678F" },
  { code: "CL-00014", name: "Sneha Kapoor", email: "sneha.kapoor@example.com", phone: "90040 67890", dob: "21/10/1989", gender: "Female", addr: "7 Gomti Nagar Extension", city: "Lucknow", state: "Uttar Pradesh", pin: "226010", job: "Lawyer", pan: "ASKPK6789G" },
  { code: "CL-00015", name: "Ganesh Iyengar", email: "", phone: "98860 78901", dob: "09/09/1968", gender: "Male", addr: "R.S. Puram", city: "Coimbatore", state: "Tamil Nadu", pin: "641002", job: "Retired", pan: "AGIPI7890H" },
  { code: "CL-00016", name: "Nikhil Shah", email: "nikhil.shah@example.com", phone: "98250 89012", dob: "13/06/1987", gender: "Male", addr: "Ring Road, Adajan", city: "Surat", state: "Gujarat", pin: "395009", job: "Textile trader", pan: "ANSPS8901J" },
  { code: "CL-00017", name: "Aishwarya Pillai", email: "aishwarya.pillai@example.com", phone: "99450 90123", dob: "29/04/1991", gender: "Female", addr: "12 HSR Layout Sector 2", city: "Bengaluru", state: "Karnataka", pin: "560102", job: "Data scientist", pan: "AAPPP9012K" },
  { code: "CL-00018", name: "Rajesh Gupta", email: "rajesh.gupta@example.com", phone: "98930 01234", dob: "05/01/1976", gender: "Male", addr: "56 Vijay Nagar", city: "Indore", state: "Madhya Pradesh", pin: "452010", job: "Wholesaler", pan: "ARGPG0123L" },
  { code: "CL-00019", name: "Fatima Sheikh", email: "fatima.sheikh@example.com", phone: "98200 55555", dob: "18/03/1984", gender: "Female", addr: "Bandra West", addr2: "Hill Road", city: "Mumbai", state: "Maharashtra", pin: "400050", job: "Film producer", pan: "AFSPS5555M" },
  { code: "CL-00020", name: "Ajay Kumar", email: "", phone: "90909 09090", dob: "24/12/1995", gender: "Male", addr: "Andheri East", city: "Mumbai", state: "Maharashtra", pin: "400069", job: "Student", pan: "" },
  { code: "CL-00021", name: "T. R. Krishnan", email: "tr.krishnan@example.com", phone: "98410 11111", dob: "02/02/1962", gender: "Male", addr: "5 Mylapore Tank Road", city: "Chennai", state: "Tamil Nadu", pin: "600004", job: "Chartered accountant", pan: "ATKPK1111N" },
  { code: "CL-00022", name: "Maria D'Souza & Sons", email: "maria.dsouza@example.com", phone: "98220 22222", dob: "15/05/1970", gender: "Female", addr: "House No. 12, Calangute", city: "Panaji", state: "Goa", pin: "403001", job: "Restaurant owner", pan: "AMDPD2222P" },
  { code: "CL-00023", name: "Ananya Bose", email: "ananya.bose@example.com", phone: "98310 33333", dob: "07/07/1994", gender: "Female", addr: "14 Salt Lake Sector 5", city: "Kolkata", state: "West Bengal", pin: "700091", job: "Journalist", pan: "AABPB3333Q" },
  { code: "CL-00024", name: "Harpreet Singh", email: "harpreet.singh@example.com", phone: "98140 44444", dob: "30/08/1982", gender: "Male", addr: "Sector 17", city: "Chandigarh", state: "Chandigarh", pin: "160017", job: "Transporter", pan: "AHSPS4444R" },
  { code: "CL-00025", name: "Lata Menon", email: "lata.menon@example.com", phone: "94471 55555", dob: "12/12/1966", gender: "Female", addr: "Vyttila Junction", city: "Kochi", state: "Kerala", pin: "682019", job: "Homemaker", pan: "ALMPM5555S" },
  { code: "CL-00026", name: "Zoya Khan", email: "zoya.khan@example.com", phone: "90001 66666", dob: "22/09/1990", gender: "Female", addr: "Jubilee Hills Road 36", city: "Hyderabad", state: "Telangana", pin: "500033", job: "Interior designer", pan: "AZKPK6666T" },
  { code: "CL-00027", name: "Prakash Jain", email: "prakash.jain@example.com", phone: "98931 77777", dob: "04/04/1973", gender: "Male", addr: "Palasia Square", city: "Indore", state: "Madhya Pradesh", pin: "452001", job: "Pharmacist", pan: "APJPJ7777U" },
  { code: "CL-00028", name: "Neha Verma", email: "neha.verma@example.com", phone: "98111 88888", dob: "16/06/1996", gender: "Female", addr: "Rohini Sector 9", city: "New Delhi", state: "Delhi", pin: "110085", job: "Physiotherapist", pan: "ANVPV8888V" },
  { code: "CL-00029", name: "Om Prakash Yadav", email: "", phone: "90041 99999", dob: "08/08/1969", gender: "Male", addr: "Aliganj", city: "Lucknow", state: "Uttar Pradesh", pin: "226024", job: "Farmer", pan: "" },
  { code: "CL-00030", name: "Shalini Nambiar", email: "shalini.nambiar@example.com", phone: "99451 00001", dob: "19/01/1986", gender: "Female", addr: "Whitefield Main Road", city: "Bengaluru", state: "Karnataka", pin: "560066", job: "HR director", pan: "ASNPN0001W" },
  { code: "CL-00031", name: "Imran Ali", email: "imran.ali@example.com", phone: "98201 00002", dob: "26/03/1988", gender: "Male", addr: "Mahim West", city: "Mumbai", state: "Maharashtra", pin: "400016", job: "Chef", pan: "AIAPA0002X" },
  { code: "CL-00032", name: "Rekha Pathak", email: "rekha.pathak@example.com", phone: "97120 00003", dob: "11/05/1975", gender: "Female", addr: "Dharampeth", city: "Nagpur", state: "Maharashtra", pin: "440010", job: "Professor", pan: "ARPPP0003Y" },
  { code: "CL-00033", name: "Anil Kumbhar", email: "", phone: "98221 00004", dob: "23/11/1979", gender: "Male", addr: "Hadapsar Industrial Estate", city: "Pune", state: "Maharashtra", pin: "411013", job: "Machinist", pan: "" },
  { code: "CL-00034", name: "Joseph Fernandes", email: "joseph.fernandes@example.com", phone: "98221 00005", dob: "01/06/1981", gender: "Male", addr: "Miramar Beach Road", city: "Panaji", state: "Goa", pin: "403002", job: "Hotelier", pan: "AJFPF0005Z" },
];

/**
 * `days` is the expiry offset from today. Everything the renewals desk, the
 * dashboard and the reminder ladder key off is chosen deliberately:
 * 0/1/7/15/30/60 sit on rule days, -30 and -31 straddle the lapse grace, and
 * 7/15/30/60/90 land on the tab boundaries.
 */
const policies = [
  { code: "CL-00001", number: "SH/2026/0091823", insurer: "Star Health and Allied Insurance", plan: "Family Health Optima", category: "Health", days: 9, si: 1000000, premium: 24500, gst: 4410, freq: "Annual", mode: "UPI", rate: 12.5, commission: 3675, nominee: "Sneha Sharma", relation: "Spouse", members: "Rohit Sharma; Sneha Sharma; Aarav Sharma", notes: "Floater covering three members." },
  { code: "CL-00001", number: "IL/MOT/778211", insurer: "ICICI Lombard General Insurance", plan: "Motor Secure Comprehensive", category: "Motor", days: 120, si: 850000, premium: 12800, gst: 2304, freq: "Annual", mode: "Net banking", rate: 10, commission: 1280, vehicle: "MH12AB1234" },
  { code: "CL-00002", number: "HE/OR/554120", insurer: "HDFC ERGO General Insurance", plan: "Optima Restore", category: "Health", days: 65, si: 1500000, premium: 31200, gst: 5616, freq: "Half yearly", mode: "Auto debit", rate: 15, commission: 4680, nominee: "Rahul Desai", relation: "Son", members: "Anita Desai; Rahul Desai" },
  { code: "CL-00002", number: "LIC/915/220481", insurer: "Life Insurance Corporation of India", plan: "Jeevan Anand", category: "Life", days: 2000, si: 5000000, premium: 48000, gst: 2160, freq: "Quarterly", mode: "Auto debit", rate: 7.5, commission: 3600, nominee: "Rahul Desai", relation: "Son" },
  { code: "CL-00003", number: "NIA/MOT/330912", insurer: "The New India Assurance Company", category: "Motor", days: -31, si: 640000, premium: 9600, gst: 1728, freq: "Annual", mode: "Cash", rate: 10, commission: 960, vehicle: "GJ01CD5678", notes: "Grace window has closed — this one should read lapsed." },
  { code: "CL-00003", number: "SH/2025/0088410", insurer: "Star Health and Allied Insurance", plan: "Family Health Optima", category: "Health", days: -30, si: 500000, premium: 21500, gst: 3870, freq: "Annual", mode: "Cheque", rate: 12.5, commission: 2687.5, notes: "Exactly on the grace boundary — still expired, not lapsed." },
  { code: "CL-00004", number: "NB/RA2/119006", insurer: "Niva Bupa Health Insurance", plan: "ReAssure 2.0", category: "Health", days: 60, si: 2000000, premium: 27800, gst: 5004, freq: "Annual", mode: "UPI", rate: 12.5, commission: 3475, nominee: "Lakshmi Iyer", relation: "Mother", members: "Meera Iyer; Lakshmi Iyer" },
  { code: "CL-00004", number: "SBI/LIFE/447120", insurer: "SBI Life Insurance", plan: "eShield Next", category: "Life", days: 3000, si: 10000000, premium: 4000, gst: 720, freq: "Monthly", mode: "Auto debit", rate: 5, commission: 200 },
  { code: "CL-00005", number: "TA/TG/908771", insurer: "Tata AIG General Insurance", plan: "Travel Guard", category: "Travel", days: 7, si: 4200000, premium: 4200, gst: 756, freq: "Single", mode: "Card", rate: 15, commission: 630, members: "Suresh Nair / Latha Nair", notes: "Schengen trip cover." },
  { code: "CL-00006", number: "CH/2026/771203", insurer: "Care Health Insurance", plan: "Care Supreme", category: "Health", days: 30, si: 1000000, premium: 22400, gst: 4032, freq: "Annual", mode: "UPI", rate: 12.5, commission: 2800, members: "Priya Menon" },
  { code: "CL-00006", number: "BA/MOT/641203", insurer: "Bajaj Allianz General Insurance", category: "Motor", days: 90, si: 1250000, premium: 14300, gst: 2574, freq: "Annual", mode: "Net banking", rate: 10, commission: 1430, vehicle: "TN07GH3456" },
  { code: "CL-00007", number: "DG/MOT/220118", insurer: "Go Digit General Insurance", plan: "Digit Motor Comprehensive", category: "Motor", days: 1, si: 980000, premium: 11200, gst: 2016, freq: "Annual", mode: "UPI", rate: 10, commission: 1120, vehicle: "TS09EF9012", notes: "Expires tomorrow — last chance before it drops out of the active list." },
  { code: "CL-00007", number: "HE/PAS/700318", insurer: "HDFC ERGO General Insurance", plan: "Personal Accident Shield", category: "Personal Accident", days: 118, si: 2500000, premium: 6400, gst: 1152, freq: "Annual", mode: "Card", rate: 15, commission: 960 },
  { code: "CL-00008", number: "HE/PAS/700904", insurer: "HDFC ERGO General Insurance", plan: "Personal Accident Shield", category: "Personal Accident", days: 15, si: 1500000, premium: 4800, gst: 864, freq: "Annual", mode: "Cheque", rate: 15, commission: 720, notes: "Switch reminders off for this client to test the opt-out." },
  { code: "CL-00009", number: "MC/CI/551190", insurer: "ManipalCigna Health Insurance", plan: "Lifestyle Protection Critical Care", category: "Critical Illness", days: 45, si: 3000000, premium: 18900, gst: 3402, freq: "Annual", mode: "Net banking", rate: 12.5, commission: 2362.5, nominee: "Rukhsana Qureshi", relation: "Spouse" },
  { code: "CL-00010", number: "OIC/HOME/440021", insurer: "The Oriental Insurance Company", plan: "Griha Raksha", category: "Home", days: 75, si: 6000000, premium: 7800, gst: 1404, freq: "Annual", mode: "Cheque", rate: 10, commission: 780 },
  { code: "CL-00011", number: "AB/HL/330778", insurer: "Aditya Birla Health Insurance", plan: "Activ Health Platinum", category: "Health", days: 0, si: 750000, premium: 19800, gst: 3564, freq: "Annual", mode: "UPI", rate: 12.5, commission: 2475, notes: "Expires today — should still count as active." },
  { code: "CL-00011", number: "RG/MOT/119284", insurer: "Reliance General Insurance", category: "Motor", days: -5, si: 420000, premium: 7400, gst: 1332, freq: "Annual", mode: "Cash", rate: 10, commission: 740, vehicle: "MH14XY7788" },
  { code: "CL-00012", number: "RG/TRV/883012", insurer: "Reliance General Insurance", plan: "Travel Care", category: "Travel", days: 3, si: 2100000, premium: 2400, gst: 432, freq: "Single", mode: "Card", rate: 15, commission: 360 },
  { code: "CL-00012", number: "SH/2026/0114552", insurer: "Star Health and Allied Insurance", plan: "Star Comprehensive", category: "Health", days: 200, si: 2500000, premium: 38400, gst: 6912, freq: "Annual", mode: "Auto debit", rate: 12.5, commission: 4800, members: "Ritu Bansal; Aman Bansal" },
  { code: "CL-00013", number: "LIC/936/880417", insurer: "Life Insurance Corporation of India", plan: "Jeevan Umang", category: "Life", days: 5000, si: 20000000, premium: 480000, gst: 21600, freq: "Single", mode: "Cheque", rate: 6, commission: 28800, nominee: "Sunita Agarwal", relation: "Spouse", notes: "Largest premium in the book — use it for the premium filters." },
  { code: "CL-00013", number: "UII/MOT/551277", insurer: "United India Insurance Company", category: "Motor", days: -400, si: 380000, premium: 6900, gst: 1242, freq: "Annual", mode: "Cash", rate: 10, commission: 690, vehicle: "RJ14PQ2020", notes: "Long dead — the oldest thing in the overdue tab." },
  { code: "CL-00014", number: "NB/RA2/220913", insurer: "Niva Bupa Health Insurance", plan: "ReAssure 2.0", category: "Health", days: 8, si: 1000000, premium: 23100, gst: 4158, freq: "Annual", mode: "UPI", rate: 12.5, commission: 2887.5 },
  { code: "CL-00014", number: "NIC/SHOP/770214", insurer: "National Insurance Company", plan: "Shopkeepers Package", category: "Other", days: 33, si: 1500000, premium: 9400, gst: 1692, freq: "Annual", mode: "Net banking", rate: 10, commission: 940 },
  { code: "CL-00015", number: "ITG/MOT/338821", insurer: "IFFCO Tokio General Insurance", category: "Motor", days: 16, si: 310000, premium: 5600, gst: 1008, freq: "Annual", mode: "Cash", rate: 10, commission: 560, vehicle: "TN38KL4545" },
  { code: "CL-00016", number: "CH/2026/882140", insurer: "Care Health Insurance", plan: "Care Freedom", category: "Health", days: 31, si: 500000, premium: 16700, gst: 3006, freq: "Annual", mode: "UPI", rate: 12.5, commission: 2087.5 },
  { code: "CL-00016", number: "TA/TG/990284", insurer: "Tata AIG General Insurance", plan: "Travel Guard", category: "Travel", days: 61, si: 3000000, premium: 3100, gst: 558, freq: "Single", mode: "Card", rate: 15, commission: 465 },
  { code: "CL-00017", number: "SH/2026/0120044", insurer: "Star Health and Allied Insurance", plan: "Star Comprehensive", category: "Health", days: 2, si: 1500000, premium: 29900, gst: 5382, freq: "Annual", mode: "UPI", rate: 12.5, commission: 3737.5, members: "Aishwarya Pillai, Rahul Pillai", notes: "Members separated with a comma rather than a semicolon." },
  { code: "CL-00017", number: "IL/PA/447712", insurer: "ICICI Lombard General Insurance", category: "Personal Accident", days: 2, si: 1000000, premium: 3200, gst: 576, freq: "Annual", mode: "Card", rate: 15, commission: 480 },
  { code: "CL-00018", number: "AK/MOT/551903", insurer: "Acko General Insurance", category: "Motor", days: 12, si: 560000, premium: 8100, gst: 1458, freq: "Annual", mode: "UPI", rate: 10, commission: 810, vehicle: "MP09RS3131" },
  { code: "CL-00018", number: "CMS/HOME/220417", insurer: "Cholamandalam MS General Insurance", plan: "Home Shield", category: "Home", days: 150, si: 4500000, premium: 6200, gst: 1116, freq: "Annual", mode: "Net banking", rate: 10, commission: 620 },
  { code: "CL-00019", number: "MC/HL/990017", insurer: "ManipalCigna Health Insurance", plan: "ProHealth Prime", category: "Health", days: 5, si: 5000000, premium: 96000, gst: 17280, freq: "Annual", mode: "Auto debit", rate: 12.5, commission: 12000, members: "Fatima Sheikh; Imtiaz Sheikh; Ayesha Sheikh" },
  { code: "CL-00020", number: "DG/TRV/117744", insurer: "Go Digit General Insurance", plan: "Digit Travel", category: "Travel", days: 20, si: 900000, premium: 850, gst: 153, freq: "Single", mode: "UPI", rate: 15, commission: 127.5, notes: "Smallest premium in the book." },
  { code: "CL-00021", number: "SH/2026/0130551", insurer: "Star Health and Allied Insurance", plan: "Senior Citizens Red Carpet", category: "Health", days: 22, si: 1000000, premium: 41200, gst: 7416, freq: "Annual", mode: "Cheque", rate: 12.5, commission: 5150, members: "T. R. Krishnan; Vasantha Krishnan" },
  { code: "CL-00022", number: "NIA/HOME/771290", insurer: "The New India Assurance Company", plan: "Householders Package", category: "Home", days: 40, si: 3500000, premium: 5400, gst: 972, freq: "Annual", mode: "Cash", rate: 10, commission: 540, notes: "Client name carries an ampersand and an apostrophe." },
  { code: "CL-00023", number: "NB/HL/447190", insurer: "Niva Bupa Health Insurance", plan: "Health Companion", category: "Health", days: 70, si: 1200000, premium: 20300, gst: 3654, freq: "Annual", mode: "UPI", rate: 12.5, commission: 2537.5, members: "Ananya Bose | Debashish Bose", notes: "Members separated with a pipe." },
  { code: "CL-00024", number: "TA/MOT/220981", insurer: "Tata AIG General Insurance", category: "Motor", days: 9, si: 1900000, premium: 21400, gst: 3852, freq: "Annual", mode: "Net banking", rate: 10, commission: 2140, vehicle: "CH01AA0001" },
  { code: "CL-00024", number: "BA/PA/117203", insurer: "Bajaj Allianz General Insurance", category: "Personal Accident", days: -7, si: 800000, premium: 2900, gst: 522, freq: "Annual", mode: "Cash", rate: 15, commission: 435, notes: "Seven days past expiry — the day the inactive post-expiry rule would fire." },
  { code: "CL-00025", number: "AB/CI/338017", insurer: "Aditya Birla Health Insurance", plan: "Activ Secure Critical Illness", category: "Critical Illness", days: -45, si: 2000000, premium: 14600, gst: 2628, freq: "Annual", mode: "Cheque", rate: 12.5, commission: 1825 },
  { code: "CL-00026", number: "CH/TRV/551028", insurer: "Care Health Insurance", plan: "Explore Travel", category: "Travel", days: 180, si: 5000000, premium: 5600, gst: 1008, freq: "Single", mode: "Card", rate: 15, commission: 840 },
  { code: "CL-00026", number: "DUP/2026/5001", insurer: "Star Health and Allied Insurance", plan: "Family Health Optima", category: "Health", days: 26, si: 700000, premium: 18200, gst: 3276, freq: "Annual", mode: "UPI", rate: 12.5, commission: 2275, notes: "Shares a policy number with a different insurer — both are legitimate." },
  { code: "CL-00027", number: "MAX/LIFE/990412", insurer: "Max Life Insurance", plan: "Smart Secure Plus", category: "Life", days: 2500, si: 15000000, premium: 32000, gst: 5760, freq: "Annual", mode: "Auto debit", rate: 7.5, commission: 2400 },
  { code: "CL-00027", number: "DUP/2026/5001", insurer: "HDFC ERGO General Insurance", plan: "Optima Secure", category: "Health", days: 27, si: 1000000, premium: 25600, gst: 4608, freq: "Annual", mode: "Net banking", rate: 12.5, commission: 3200, notes: "The other half of the shared policy number." },
  { code: "CL-00028", number: "MC/HL/117290", insurer: "ManipalCigna Health Insurance", plan: "ProHealth Plus", category: "Health", days: 6, si: 800000, premium: 17400, gst: 3132, freq: "Annual", mode: "UPI", rate: 12.5, commission: 2175, notes: "Cancel this one by hand to see the cancelled status." },
  { code: "CL-00029", number: "OIC/MOT/447021", insurer: "The Oriental Insurance Company", category: "Motor", days: 28, si: 290000, premium: 5100, gst: 918, freq: "Annual", mode: "Cash", rate: 10, commission: 510, vehicle: "UP32MN6767" },
  { code: "CL-00030", number: "HE/OR/990128", insurer: "HDFC ERGO General Insurance", plan: "Optima Restore", category: "Health", days: 14, si: 2000000, premium: 34700, gst: 6246, freq: "Annual", mode: "Auto debit", rate: 12.5, commission: 4337.5, members: "Shalini Nambiar; Arun Nambiar; Kiran Nambiar" },
  { code: "CL-00030", number: "IL/TRV/220774", insurer: "ICICI Lombard General Insurance", plan: "Travel Insurance", category: "Travel", days: -2, si: 1800000, premium: 2100, gst: 378, freq: "Single", mode: "Card", rate: 15, commission: 315 },
  { code: "CL-00031", number: "DG/MOT/883014", insurer: "Go Digit General Insurance", plan: "Digit Motor Comprehensive", category: "Motor", days: 52, si: 1100000, premium: 13200, gst: 2376, freq: "Annual", mode: "UPI", rate: 10, commission: 1320, vehicle: "MH01ZZ9999" },
  { code: "CL-00032", number: "NIC/HOME/338290", insurer: "National Insurance Company", plan: "Griha Suraksha", category: "Home", days: 88, si: 2800000, premium: 4700, gst: 846, freq: "Annual", mode: "Cheque", rate: 10, commission: 470 },
  { code: "CL-00033", number: "SH/2026/0140228", insurer: "Star Health and Allied Insurance", plan: "Family Health Optima", category: "Health", days: 38, si: 600000, premium: 19100, gst: 3438, freq: "Annual", mode: "Cash", rate: 12.5, commission: 2387.5 },
  { code: "CL-00034", number: "TA/PA/551408", insurer: "Tata AIG General Insurance", plan: "Accident Guard", category: "Personal Accident", days: 100, si: 5000000, premium: 8900, gst: 1602, freq: "Annual", mode: "Card", rate: 15, commission: 1335 },
];

// ------------------------------------------------------------- the families --

/**
 * A second book whose whole purpose is the relationships. Everybody on a floater
 * is a client, so a cover list is how a family gets into the book, and these rows
 * are ordered to build one deliberate shape: three generations entered a policy
 * at a time, a daughter-in-law who belongs to two households, and two unrelated
 * families joined by a name common enough to catch the importer out.
 *
 * The codes below join these two arrays and are written out blank, which is the
 * honest shape for a file like this: an agency listing families has names, not
 * numbers. Declaring them would collide — a relative created by an early row
 * takes the next code going, and a later row claiming that code for its holder
 * would land its policy on the relative, because a code outranks every other way
 * of matching a row.
 */
const familyClients = [
  { code: "CL-00301", name: "Mohan Rangan", email: "mohan.rangan@example.com", phone: "98410 30001", dob: "06/06/1954", gender: "Male", addr: "3 Luz Church Road", city: "Chennai", state: "Tamil Nadu", pin: "600004", job: "Retired", pan: "AMRPR3001A" },
  { code: "CL-00302", name: "Rajesh Rangan", email: "rajesh.rangan@example.com", phone: "98410 30002", dob: "18/02/1984", gender: "Male", addr: "12 Besant Nagar", city: "Chennai", state: "Tamil Nadu", pin: "600090", job: "Banker", pan: "ARRPR3002B" },
  { code: "CL-00303", name: "Lakshmi Menon", email: "lakshmi.menon@example.com", phone: "94470 30003", dob: "22/08/1959", gender: "Female", addr: "Kadavanthra", city: "Kochi", state: "Kerala", pin: "682020", job: "Retired teacher", pan: "ALMPM3003C" },
  { code: "CL-00304", name: "Ganesh Pai", email: "ganesh.pai@example.com", phone: "98450 30004", dob: "11/03/1978", gender: "Male", addr: "5 Malleswaram 8th Cross", city: "Bengaluru", state: "Karnataka", pin: "560003", job: "Printer", pan: "AGPPP3004D" },
  { code: "CL-00305", name: "Sunil Pai", email: "sunil.pai@example.com", phone: "98220 30005", dob: "29/07/1981", gender: "Male", addr: "Kothrud Depot Road", city: "Pune", state: "Maharashtra", pin: "411038", job: "Electrician", pan: "ASPPP3005E" },
];

/**
 * `lives` is the cover list, and the order of these rows is the point of them.
 * Rajesh arrives as a name on his father's policy and is a client from that
 * moment; his own floater two rows later finds him rather than opening a second
 * copy, and the policy makes him a policyholder with nothing to correct.
 */
const familyPolicies = [
  { code: "CL-00301", number: "SH/2026/0301551", insurer: "Star Health and Allied Insurance", plan: "Senior Citizens Red Carpet", category: "Health", days: 24, si: 1000000, premium: 43600, gst: 7848, freq: "Annual", mode: "Cheque", rate: 12.5, commission: 5450, nominee: "Vasanthi Rangan", relation: "Spouse", lives: "Mohan Rangan; Vasanthi Rangan; Rajesh Rangan (Son)", notes: "Three lives, two of them new to the book. His wife is named only in the nominee column, and that is where her relationship comes from." },
  { code: "CL-00302", number: "NB/RA2/302118", insurer: "Niva Bupa Health Insurance", plan: "ReAssure 2.0", category: "Health", days: 41, si: 2000000, premium: 28900, gst: 5202, freq: "Annual", mode: "Auto debit", rate: 12.5, commission: 3612.5, nominee: "Priya Rangan", relation: "Spouse", lives: "Self; Priya Rangan; Aarav Rangan (Son)", notes: "The holder was entered by the row above as somebody's son, and is written here the way a register writes him." },
  { code: "CL-00302", number: "HE/PAS/302904", insurer: "HDFC ERGO General Insurance", plan: "Personal Accident Shield", category: "Personal Accident", days: 96, si: 2500000, premium: 6100, gst: 1098, freq: "Annual", mode: "Card", rate: 15, commission: 915, lives: "Rajesh Rangan / Aarav Rangan", notes: "A second policy over two of the same people, so nobody is entered again." },
  { code: "CL-00302", number: "IL/MOT/302774", insurer: "ICICI Lombard General Insurance", plan: "Motor Secure Comprehensive", category: "Motor", days: 130, si: 900000, premium: 13400, gst: 2412, freq: "Annual", mode: "Net banking", rate: 10, commission: 1340, vehicle: "TN07RN2024", notes: "A policy covering nobody but its holder, on a client who has a family." },
  { code: "CL-00303", number: "CH/2026/303028", insurer: "Care Health Insurance", plan: "Care Supreme", category: "Health", days: 11, si: 1200000, premium: 39400, gst: 7092, freq: "Annual", mode: "UPI", rate: 12.5, commission: 4925, lives: "Lakshmi Menon | Daughter - Priya Rangan", notes: "Her daughter is already in the book, so this joins two households rather than adding a second Priya." },
  { code: "CL-00304", number: "HE/OS/304190", insurer: "HDFC ERGO General Insurance", plan: "Optima Secure", category: "Health", days: 63, si: 1000000, premium: 26300, gst: 4734, freq: "Annual", mode: "UPI", rate: 12.5, commission: 3287.5, lives: "Ganesh Pai, Anil Kumar (Brother)", notes: "A common name, entered here first." },
  { code: "CL-00305", number: "CH/2026/305412", insurer: "Care Health Insurance", plan: "Care Freedom", category: "Health", days: 77, si: 700000, premium: 17900, gst: 3222, freq: "Annual", mode: "Cash", rate: 12.5, commission: 2237.5, lives: "Sunil Pai; Anil Kumar (Brother)", notes: "The same common name, a different family. One person of that name is in the book, so this links to him — see the README." },
];

/**
 * Mirrors `relations::find_or_create_relative` and the dependent rule, so the
 * numbers the README states are the ones the importer will produce rather than a
 * description of them that can quietly go stale.
 */
function resolveCover(book, rows, coverOf) {
  const people = book.map((c) => ({ name: c.name, code: c.code, created: false }));
  const idOf = (name) => people.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  const edges = new Map();
  const holders = new Set();
  const cover = [];

  // The pair is what is unique, not the direction, so the key is sorted. `from` is
  // the end the word was said from: "son" said by Mohan about Rajesh reads "son of"
  // on Rajesh's page. Silence leaves a recorded word and its direction alone; a
  // word the file states replaces both, exactly as `relations::link` does.
  const pair = (a, b) => [a, b].sort((x, y) => x - y).join("|");
  const related = (a, b) => edges.has(pair(a, b));
  const edge = (a, b, word) =>
    edges.set(pair(a, b), word ? { word, from: a } : edges.get(pair(a, b)) ?? { word: "other", from: a });

  // `util.splitRelationship`, kept to the same vocabulary as both editions.
  const WORDS = {
    spouse: "spouse", wife: "spouse", husband: "spouse", partner: "spouse",
    son: "son", daughter: "daughter", father: "father", dad: "father",
    mother: "mother", mom: "mother", brother: "brother", sister: "sister",
    self: "self", proposer: "self", primary: "self", insured: "self", policyholder: "self",
  };
  const split = (entry) => {
    const text = entry.trim();
    if (WORDS[text.toLowerCase()]) return { name: "", word: WORDS[text.toLowerCase()] };

    const bracket = /^(.*?)\s*(?:\(([^)]*)\)|\[([^\]]*)\])$/.exec(text);
    const inner = (bracket?.[2] ?? bracket?.[3] ?? "").trim().toLowerCase();
    if (bracket && WORDS[inner]) return { name: bracket[1].trim(), word: WORDS[inner] };
    for (const separator of [":", "-"]) {
      const [head, ...rest] = text.split(separator);
      if (rest.length > 0 && WORDS[head.trim().toLowerCase()] && rest.join(separator).trim()) {
        return { name: rest.join(separator).trim(), word: WORDS[head.trim().toLowerCase()] };
      }
    }
    return { name: text, word: null };
  };

  for (const row of rows) {
    const holder = people.findIndex((p) => p.code === row.code);
    holders.add(holder);

    const named = (coverOf(row) ?? "")
      .split(/[,;/|]/)
      .map((n) => n.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    const covered = [];
    for (const entry of named) {
      const { name, word } = split(entry);

      // A cell that is only a relationship names nobody, except 'self'.
      if (name === "") {
        if (word === "self") covered.push(holder);
        continue;
      }

      // Where no word was written beside the name, the nominee columns may carry
      // one for this person.
      const stated = word
        ?? (row.nominee?.toLowerCase() === name.toLowerCase() ? WORDS[row.relation?.toLowerCase()] : null)
        ?? null;

      if (people[holder].name.toLowerCase() === name.toLowerCase()) {
        covered.push(holder);
        continue;
      }

      const already = people.findIndex((_, i) => i !== holder && related(holder, i)
        && people[i].name.toLowerCase() === name.toLowerCase());
      if (already !== -1) {
        edge(holder, already, stated);
        covered.push(already);
        continue;
      }

      // One client of that name is a person; two are two people, and the
      // importer will not choose between them.
      const matches = people.filter((p) => p.name.toLowerCase() === name.toLowerCase()).length;
      const id = matches === 1 ? idOf(name) : people.push({ name, code: "", created: true }) - 1;
      edge(holder, id, stated);
      covered.push(id);
    }

    if (covered.length > 0) cover.push({ policy: row.number, covered });
  }

  const ends = (e) => e.split("|").map(Number);
  const linked = (i) => [...edges.keys()].some((e) => ends(e).includes(i));
  const dependents = people.filter((_, i) => !holders.has(i) && linked(i));

  // The walk both editions do in code: everybody reachable by following edges in
  // either direction, which is what makes a family the same from any of them.
  const walk = (start) => {
    const seen = new Set([start]);
    for (const queue = [start]; queue.length > 0; ) {
      const at = queue.shift();
      for (const e of edges.keys()) {
        const [a, b] = ends(e);
        const next = a === at ? b : b === at ? a : null;
        if (next !== null && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return [...seen].map((i) => people[i].name);
  };
  const step = (start) => [...edges]
    .filter(([e]) => ends(e).includes(start))
    .map(([e, { word, from }]) => {
      const [a, b] = ends(e);
      return {
        name: people[a === start ? b : a].name,
        relationship: from === start ? word : `${word} of`,
      };
    });

  return {
    people,
    holders: [...holders].map((i) => people[i].name),
    added: people.filter((p) => p.created).map((p) => p.name),
    dependents: dependents.map((p) => p.name),
    edges: edges.size,
    // What the file managed to say about each pair, which is the difference
    // between a family tree and a list of people who share a policy.
    named: [...edges.values()].filter(({ word }) => word !== "other").length,
    cover,
    walk: (name) => walk(idOf(name)),
    step: (name) => step(idOf(name)),
  };
}

// -------------------------------------------------------------- file shapes --

const BOOK_HEADERS = [
  "Client name", "Client code", "Email", "Mobile", "Alternate phone", "Date of birth", "Gender",
  "Address", "Address line 2", "City", "State", "Pincode", "Occupation", "PAN",
  "Policy number", "Insurer", "Plan", "Category", "Start date", "Expiry date",
  "Sum insured", "Premium", "GST", "Premium frequency", "Payment mode",
  "Commission rate", "Commission amount", "Nominee", "Nominee relation", "Vehicle number",
  "Covered members", "Notes",
];

function bookRow(policy, book = clients) {
  const client = book.find((c) => c.code === policy.code);
  const start = policy.startDays ?? policy.days - 364;
  return [
    client.name, client.code, client.email, client.phone, client.alt ?? "", client.dob, client.gender,
    client.addr, client.addr2 ?? "", client.city, client.state, client.pin, client.job, client.pan,
    policy.number, policy.insurer, policy.plan ?? "", policy.category,
    policy.startBlank ? "" : dmy(start), dmy(policy.days),
    policy.si, policy.premium, policy.gst, policy.freq, policy.mode,
    policy.rate, policy.commission, policy.nominee ?? "", policy.relation ?? "", policy.vehicle ?? "",
    policy.members ?? policy.lives ?? "", policy.notes ?? "",
  ];
}

/** Real agency spreadsheets name their columns anything but the field label. */
const MESSY_HEADERS = [
  "Sr No", "Customer Name", "Cust Code", "E-Mail ID", "Mobile No", "DOB", "Sex",
  "Residential Address", "Area", "Town", "State", "PIN Code", "Profession", "PAN No",
  "Policy No.", "Insurance Company", "Plan Name", "LOB", "Risk Start Date", "Valid Till",
  "Sum Assured", "Gross Premium", "Service Tax", "Payment Frequency", "Mode",
  "Brokerage", "Nominee Name", "Relation With Nominee", "Reg No", "Lives Covered", "Remarks",
];

function messyRows() {
  return [
    ["1", "MOHAMMED RAFIQ", "CL-00101", "rafiq@example.com", "+91 98765-11111", "14/05/85", "M",
      "9 Charminar Road", "Old City", "Hyderabad", "Telangana", "500002", "Trader", "abcpr1111a",
      "STAR/HYD/2026/001", "Star Health", "Family Health Optima", "Mediclaim", dmy(-360), dmy(5),
      "₹10,00,000", "Rs. 24,500.50", "4,410", "Yearly", "UPI", "3,675", "Nafisa Rafiq", "Wife", "", "Mohammed Rafiq; Nafisa Rafiq", "Day-first date, rupee formatting, partial insurer name."],

    ["2", "sunita  devi", "", "sunita.devi@example.com", "098765 22222", "02-11-1979", "F",
      "12 Civil Lines", "", "Kanpur", "Uttar Pradesh", "208001", "Shopkeeper", "",
      "NIA/KNP/55120", "New India", "", "Two Wheeler", dmy(-300), `${dmy(12).replaceAll("/", "-")}`,
      "75000", "2,100", "378", "H", "Cash", "210", "", "", "UP78AB1122", "", "Dash dates, no plan, no client code."],

    ["3", "K. Raghavan", "CL-00103", "raghavan[at]example.com", "9840 111 2222", "09.09.1968", "Male",
      "5 Gandhipuram", "", "Coimbatore", "Tamil Nadu", "641012", "Retired", "AGRPR3333C",
      "LIC/TERM/990041", "LIC", "Jeevan Amar", "Term Plan", "", dmy(25),
      "50,00,000", "18000", "3240", "Q", "Auto debit", "1350", "Kamala Raghavan", "Spouse", "", "", "Malformed email is dropped, blank start date is back-dated a year."],

    ["4", "Jaspreet Kaur", "CL-00104", "jaspreet.kaur@example.com", "98140 33333", "30-Aug-1982", "F",
      "Sector 22", "", "Chandigarh", "Chandigarh", "160022", "Boutique owner", "AJKPK4444D",
      "KMG/TRV/117788", "Kotak Mahindra General Insurance", "Explore Travel", "Overseas Travel", dmy(-10), dmy(70),
      "40,00,000", "3,900", "702", "single premium", "Card", "585", "", "", "", "Jaspreet Kaur", "Insurer that is not seeded — the import should create it."],

    ["5", "Devendra Joshi", "CL-00105", "devendra.joshi@example.com", "97660 44444", "5 September 1971", "Male",
      "Trimbak Road", "", "Nashik", "Maharashtra", "422002", "Vintner", "ADJPJ5555E",
      "OIC/HH/220914", "Oriental", "Householders Package", "Householder's Package", dmy(-200), `${serial(48)}`,
      "25,00,000", "5,200", "936", "Yearly", "Cheque", "520", "", "", "", "", "Expiry written as an Excel serial number."],

    ["6", "Lily Mathew", "CL-00106", "lily.mathew@example.com", "94470 55555", "Mar 03, 1977", "Female",
      "MG Road", "Ravipuram", "Kochi", "Kerala", "682015", "Nurse", "ALMPM6666F",
      "HDFC/PA/447120", "HDFC Ergo", "Personal Accident Shield", "PA Cover", dmy(-100), `${iso(35)}`,
      "15,00,000", "3,100", "558", "Yearly", "Net banking", "465", "Tomy Mathew", "Husband", "", "", "ISO expiry, US-style date of birth."],

    ["7", "Bhaskar Rao", "CL-00107", "bhaskar.rao@example.com", "90080 66666", "1985-11-11", "Transgender",
      "Jayanagar", "", "Bengaluru", "Karnataka", "560041", "Auditor", "ABRPR7777G",
      "ABHI/CI/551190", "Aditya Birla", "Activ Secure", "Cancer Care", dmy(-50), iso(95).replaceAll("-", "/"),
      "30,00,000", "16,400", "2,952", "M", "UPI", "2050", "", "", "", "", "Gender outside male/female, year-first slashed date."],

    ["8", "Nandini  Iyer", "CL-00108", "nandini.iyer@example.com", "99450 77777", "21/10/1989", "F",
      "HSR Layout", "Sector 1", "Bengaluru", "Karnataka", "560102", "Dentist", "ANIPI8888H",
      "STAR/BLR/2026/990", "STAR", "Star Comprehensive", "", dmy(-330), dmy(55),
      "12,00,000", "26,700", "4,806", "Yearly", "UPI", "3,337.50", "", "", "", "Nandini Iyer; Karthik Iyer", "Blank category — it should be read off the plan name. Insurer given by short code."],

    ["9", "Gurmeet Singh", "CL-00109", "gurmeet.singh@example.com", "98141 88888", "12/12/1966", "M",
      "Model Town", "", "Ludhiana", "Punjab", "141002", "Transporter", "AGSPS9999J",
      "ITG/GOODS/338291", "IFFCO Tokio", "Goods Carrying Vehicle", "Commercial Vehicle", dmy(-280), dmy(85),
      "8,50,000", "44,200", "7,956", "Yearly", "Cheque", "4,420", "", "", "PB10CD3344", "", "Category the app has no bucket for — expect Other."],

    ["10", "Rita  Fernandes", "CL-00110", "rita.fernandes@example.com", "98221 99999", "01/06/1981", "F",
      "Miramar", "", "Panaji", "Goa", "403001", "Hotelier", "ARFPF1010K",
      "CHOLA/SHOP/770215", "Cholamandalam", "Shop Package", "Fire & Burglary", dmy(-150), dmy(-3),
      "60,00,000", "(1,200)", "216", "Yearly", "Net banking", "120", "", "", "", "", "Premium in accounting brackets reads as negative; already expired."],
  ];
}

function brokenRows() {
  const row = (over) => ({
    name: "Test Client", code: "", email: "", phone: "",
    number: "BRK/2026/0000", insurer: "Star Health and Allied Insurance", plan: "",
    category: "Health", start: dmy(-360), expiry: dmy(45), si: "500000", premium: "12000",
    gst: "2160", notes: "", ...over,
  });

  return [
    row({ name: "", number: "BRK/2026/0001", notes: "No client name — the row must fail." }),
    row({ number: "", notes: "No policy number — the row must fail. The client it would have created is rolled back with it." }),
    row({ number: "BRK/2026/0003", insurer: "", notes: "No insurer — the row must fail." }),
    row({ number: "BRK/2026/0004", expiry: "N/A", notes: "Expiry is not a date — the row must fail." }),
    row({ number: "BRK/2026/0005", expiry: "31/02/2027", notes: "31 February does not exist — the row must fail." }),
    row({ name: "Rahul Bhatt", number: "BRK/2026/0006", email: "rahul[at]example.com", notes: "Bad address: the row imports and the email is dropped." }),
    row({ name: "Rohit Sharma", email: "rohit.sharma@example.com", number: "SH/2026/0091823", premium: "26900", notes: "Already in the clean book: updated, or skipped with updates off." }),
    row({ name: "Twice Over", number: "BRK/2026/0008", notes: "First of two rows carrying the same number." }),
    row({ name: "Twice Over", number: "BRK/2026/0008", premium: "13500", notes: "Second row updates the first inside the same import." }),
    row({ name: 'O\'Brien, Sean & Co. "The Agency"', number: "BRK/2026/0010", notes: "Quotes, a comma and an ampersand in one name." }),
    row({ name: "अनुज शर्मा", number: "BRK/2026/0011", email: "anuj.sharma@example.com", notes: "Devanagari name — search should still find it." }),
    row({ name: "No Phone Person", number: "BRK/2026/0012", phone: "not on file", notes: "Phone with no digits is stored as nothing." }),
    row({ name: "Long Notes Person", number: "BRK/2026/0013", notes: `Very long remark. ${"The client asked for a call before renewal and wants the floater reviewed. ".repeat(8)}` }),
    row({ name: "", number: "", insurer: "", plan: "", start: "", expiry: "", si: "", premium: "", gst: "", category: "", notes: "" }),
    row({ name: "Gadget Guy", number: "BRK/2026/0015", category: "Gadget cover", notes: "Unknown category falls back to Other." }),
    row({ name: "Bad Numbers", number: "BRK/2026/0016", si: "not known", premium: "TBD", notes: "Unreadable amounts are stored as nothing; the row still imports." }),
    row({ name: "Shared Number", number: "SH/2026/0091823", insurer: "Care Health Insurance", notes: "Same number as the clean book but a different insurer — allowed." }),
  ];
}

function correctionRows() {
  return [
    { name: "Rohit S Sharma", code: "", email: "rohit.sharma@example.com", phone: "", city: "Mumbai",
      number: "SH/2026/0091823", insurer: "Star Health and Allied Insurance", premium: "25900", expiry: iso(9),
      notes: "Matched on email. City must stay Pune — filling gaps never overwrites." },
    { name: "Vikram Patel", code: "", email: "vikram.patel@example.com", phone: "99250 44556", city: "Ahmedabad",
      number: "NIA/MOT/330912", insurer: "The New India Assurance Company", premium: "9600", expiry: iso(-31),
      notes: "Matched on phone. The client gains the email he was missing." },
    { name: "meera iyer", code: "", email: "", phone: "", city: "Bengaluru",
      number: "NB/RA2/119006", insurer: "Niva Bupa Health Insurance", premium: "28400", expiry: iso(60),
      notes: "Matched on name alone, ignoring case and spacing." },
    { name: "Someone Else Entirely", code: "CL-00003", email: "someone.else@example.com", phone: "90000 11111", city: "Surat",
      number: "SH/2025/0088410", insurer: "Star Health and Allied Insurance", premium: "21500", expiry: iso(-30),
      notes: "Client code wins over every other match, so this lands on Vikram Patel." },
    { name: "Ajay Kumar", code: "CL-00020", email: "ajay.kumar@example.com", phone: "90909 09090", city: "Mumbai",
      number: "DG/TRV/117744", insurer: "Go Digit General Insurance", premium: "850", expiry: iso(20),
      notes: "Adds the missing email, so the no-email count drops by one." },
  ];
}

// ------------------------------------------------------------------ writers --

function delimited(headers, rows, separator) {
  const cell = (value) => {
    const text = String(value ?? "");
    if (separator === "\t") return text.replaceAll("\t", " ");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(separator)).join("\n") + "\n";
}

function write(name, contents) {
  writeFileSync(join(OUT, name), contents);
  return name;
}

// ------------------------------------------------------- a very small .xlsx --

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Store-only ZIP. An .xlsx is a zip of XML parts and nothing more. */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01, so the files are byte-stable
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(0, 30); // extra + comment lengths
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

const xmlEscape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function column(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - remainder) / 26);
  }
  return name;
}

/** `{ v, kind }` where kind is text (default), number or date. */
function sheetXml(rows) {
  const body = rows
    .map((cells, r) => {
      const inner = cells
        .map((cell, c) => {
          const ref = `${column(c)}${r + 1}`;
          const value = typeof cell === "object" && cell !== null ? cell : { v: cell, kind: "text" };
          if (value.kind === "number") return `<c r="${ref}"><v>${value.v}</v></c>`;
          if (value.kind === "date") return `<c r="${ref}" s="1"><v>${value.v}</v></c>`;
          if (value.v === "" || value.v === undefined || value.v === null) return "";
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value.v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${inner}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function workbook(sheets) {
  const sheetTags = sheets
    .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  const entries = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
  ];

  sheets.forEach((s, i) => entries.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)]));
  return zip(entries);
}

function workbookRows() {
  const number = (v) => ({ v, kind: "number" });
  const date = (offset) => ({ v: serial(offset), kind: "date" });

  const rows = [BOOK_HEADERS];
  const picks = [
    { code: "CL-00201", name: "Yashwant Deshmukh", email: "yashwant.deshmukh@example.com", phone: "98220 12001", city: "Pune", state: "Maharashtra", pin: "411038", number: "XL/2026/0001", insurer: "Star Health and Allied Insurance", plan: "Family Health Optima", category: "Health", days: 4, si: 1000000, premium: 25600, gst: 4608, vehicle: "", members: "Yashwant Deshmukh; Manisha Deshmukh" },
    { code: "CL-00202", name: "Padma Subramanian", email: "padma.s@example.com", phone: "98410 12002", city: "Chennai", state: "Tamil Nadu", pin: "600028", number: "XL/2026/0002", insurer: "Care Health Insurance", plan: "Care Supreme", category: "Health", days: 19, si: 1500000, premium: 30100, gst: 5418, vehicle: "", members: "Padma Subramanian" },
    { code: "CL-00203", name: "Bikram Ghosh", email: "bikram.ghosh@example.com", phone: "98310 12003", city: "Kolkata", state: "West Bengal", pin: "700029", number: "XL/2026/0003", insurer: "ICICI Lombard General Insurance", plan: "", category: "Motor", days: 37, si: 720000, premium: 10400, gst: 1872, vehicle: "WB02QR8080", members: "" },
    { code: "CL-00204", name: "Neelam Chauhan", email: "", phone: "98110 12004", city: "Gurugram", state: "Haryana", pin: "122002", number: "XL/2026/0004", insurer: "Tata AIG General Insurance", plan: "Travel Guard", category: "Travel", days: 58, si: 2500000, premium: 3300, gst: 594, vehicle: "", members: "Neelam Chauhan; Vivaan Chauhan" },
    { code: "CL-00205", name: "Sameer Kulkarni", email: "sameer.kulkarni@example.com", phone: "98221 12005", city: "Pune", state: "Maharashtra", pin: "411007", number: "XL/2026/0005", insurer: "Bajaj Allianz General Insurance", plan: "", category: "Motor", days: -12, si: 480000, premium: 8200, gst: 1476, vehicle: "MH12ZX4747", members: "" },
    { code: "CL-00206", name: "Ruchi Malhotra", email: "ruchi.malhotra@example.com", phone: "98111 12006", city: "New Delhi", state: "Delhi", pin: "110024", number: "XL/2026/0006", insurer: "Niva Bupa Health Insurance", plan: "Health Companion", category: "Health", days: 82, si: 2000000, premium: 33800, gst: 6084, vehicle: "", members: "Ruchi Malhotra; Dev Malhotra" },
  ];

  for (const p of picks) {
    rows.push([
      p.name, p.code, p.email, p.phone, "", date(-12000), p.city === "Pune" ? "Male" : "Female",
      `${p.city} address line`, "", p.city, p.state, number(Number(p.pin)), "Professional", "",
      p.number, p.insurer, p.plan, p.category, date(p.days - 364), date(p.days),
      number(p.si), number(p.premium), number(p.gst), "Annual", "UPI",
      number(12.5), number(Math.round(p.premium * 0.125)), "", "", p.vehicle,
      p.members, "Typed cells: real dates and real numbers, not text.",
    ]);
  }

  // One row with everything as text, to prove both paths read the same.
  rows.push([
    "Textual Tarun", "CL-00207", "tarun.text@example.com", "98221 12007", "", "01/01/1980", "Male",
    "Text Lane", "", "Nagpur", "Maharashtra", "440001", "Clerk", "",
    "XL/2026/0007", "HDFC ERGO General Insurance", "Optima Secure", "Health", dmy(-354), dmy(11),
    "800000", "18400", "3312", "Annual", "Cheque", "12.5", "2300", "", "", "", "", "Every cell is a string.",
  ]);

  return rows;
}

// ------------------------------------------------------------------ volume ---

function volumeRows() {
  const cities = [
    ["Pune", "Maharashtra", "4110"], ["Mumbai", "Maharashtra", "4000"], ["Bengaluru", "Karnataka", "5600"],
    ["Chennai", "Tamil Nadu", "6000"], ["Hyderabad", "Telangana", "5000"], ["Kolkata", "West Bengal", "7000"],
    ["Ahmedabad", "Gujarat", "3800"], ["Jaipur", "Rajasthan", "3020"], ["Lucknow", "Uttar Pradesh", "2260"],
    ["Kochi", "Kerala", "6820"],
  ];
  const given = [["Aarti", "Female"], ["Bharat", "Male"], ["Chetan", "Male"], ["Divya", "Female"],
    ["Esha", "Female"], ["Gaurav", "Male"], ["Hema", "Female"], ["Ishaan", "Male"], ["Jyoti", "Female"],
    ["Kiran", "Female"], ["Lalit", "Male"], ["Mohan", "Male"], ["Nisha", "Female"], ["Omkar", "Male"],
    ["Pooja", "Female"], ["Rahul", "Male"], ["Sarita", "Female"], ["Tarun", "Male"], ["Uma", "Female"],
    ["Varun", "Male"]];
  const first = given.map(([name]) => name);
  const last = ["Agarwal", "Bhat", "Chandra", "Desai", "Gowda", "Hegde", "Jain", "Kamat", "Lal", "Mehta",
    "Nayak", "Pandey", "Rane", "Sinha"];
  const initials = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const catalogue = [
    ["Star Health and Allied Insurance", "Family Health Optima", "Health"],
    ["HDFC ERGO General Insurance", "Optima Secure", "Health"],
    ["ICICI Lombard General Insurance", "Motor Secure Comprehensive", "Motor"],
    ["Bajaj Allianz General Insurance", "", "Motor"],
    ["Tata AIG General Insurance", "Travel Guard", "Travel"],
    ["Life Insurance Corporation of India", "Jeevan Anand", "Life"],
    ["Care Health Insurance", "Care Supreme", "Health"],
    ["The Oriental Insurance Company", "Griha Raksha", "Home"],
  ];

  const rows = [];
  const seen = new Set();
  for (let i = 0; i < 240; i += 1) {
    const code = `CL-0${(1000 + i).toString()}`;
    // The middle initial is what keeps these distinct: a client is matched on
    // name when it has nothing better, so repeated names would merge rows.
    const name = `${first[i % first.length]} ${initials[i % 26]}. ${last[(i * 3) % last.length]}`;
    if (seen.has(name)) throw new Error(`duplicate volume client: ${name}`);
    seen.add(name);
    const [city, state, pinPrefix] = cities[i % cities.length];
    const [insurer, plan, category] = catalogue[i % catalogue.length];
    const days = ((i * 13) % 420) - 60;
    const premium = 4000 + ((i * 317) % 46000);
    const handle = `${first[i % first.length]}.${last[(i * 3) % last.length]}.${i}`.toLowerCase();
    rows.push([
      name, code, i % 6 === 0 ? "" : `${handle}@example.com`,
      `9${(800000000 + i * 137).toString().slice(0, 9)}`, "", "", given[i % given.length][1],
      `${(i % 90) + 1} Main Road`, "", city, state, `${pinPrefix}${(i % 90) + 10}`, "", "",
      `VOL/2026/${(10000 + i).toString()}`, insurer, plan, category, dmy(days - 364), dmy(days),
      500000 + ((i * 7919) % 4500000), premium, Math.round(premium * 0.18), "Annual",
      ["UPI", "Cheque", "Cash", "Net banking", "Card"][i % 5], 12.5, Math.round(premium * 0.125),
      "", "", category === "Motor" ? `MH${10 + (i % 40)}AA${1000 + i}` : "", "", "",
    ]);
  }
  return rows;
}

// ------------------------------------------------------------------ report ---

const cleanBook = resolveCover(clients, policies, (p) => p.members);
const family = resolveCover(familyClients, familyPolicies, (p) => p.lives);

function counts() {
  const inWindow = (lo, hi) => policies.filter((p) => p.days >= lo && p.days <= hi).length;
  // The dashboard's category mix counts active policies only.
  const byCategory = {};
  for (const p of policies.filter((p) => p.days >= 0)) {
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
  }

  return {
    clients: clients.length,
    // A named life is a client, so importing the clean book puts more people in
    // the book than it has policyholders.
    relatives: cleanBook.added.length,
    people: clients.length + cleanBook.added.length,
    policies: policies.length,
    noEmail: clients.filter((c) => !c.email).length,
    overdue: policies.filter((p) => p.days < 0).length,
    lapsed: policies.filter((p) => p.days < -30).length,
    expired: policies.filter((p) => p.days < 0 && p.days >= -30).length,
    within7: inWindow(0, 7),
    within30: inWindow(0, 30),
    within60: inWindow(0, 60),
    within90: inWindow(0, 90),
    bucket0: inWindow(0, 7),
    bucket8: inWindow(8, 15),
    bucket16: inWindow(16, 30),
    bucket31: inWindow(31, 60),
    bucket61: inWindow(61, 90),
    next45: inWindow(0, 45),
    byCategory,
    premium: policies.filter((p) => p.days >= 0).reduce((sum, p) => sum + p.premium, 0),
    commission: policies.filter((p) => p.days >= 0).reduce((sum, p) => sum + p.commission, 0),
    ruleDays: [60, 30, 15, 7, 1].map((d) => [d, policies.filter((p) => p.days === d).length]),
  };
}

/** The relatives of one person, worded the way their page labels them. */
function label(relatives) {
  const one = ({ name, relationship }) =>
    `**${relationship[0].toUpperCase()}${relationship.slice(1)}** ${name.split(" ")[0]}`;
  return relatives.map(one).join(", ");
}

function readme(files) {
  const c = counts();
  const money = (n) => `₹${n.toLocaleString("en-IN")}`;
  const categoryRows = Object.entries(c.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `| ${name} | ${n} |`)
    .join("\n");

  return `# Sample book

A dataset for exercising every screen by hand. Written by
\`scripts/sample-data.mjs\` with expiry dates measured from **${iso(0)}**, so the
renewals tabs, the dashboard buckets and the reminder ladder all have policies
sitting exactly on their boundaries. Regenerate whenever the dates go stale:

\`\`\`bash
npm run sample:data
\`\`\`

Every name, number, address and PAN here is invented.

## The files

| File | Import it to see |
| --- | --- |
${files.map(([name, purpose]) => `| \`${name}\` | ${purpose} |`).join("\n")}

Import them in number order, and run **Check without saving** before each one.
Leave \`04-corrections.csv\` until last: it rewrites the policies it touches, and
seeing that is the point of it.

## 1. The clean book

${c.clients} policyholders and ${c.policies} policies, with headers named exactly as
the import screen names its fields, so every column maps on the first pass and
**Unmapped** stays empty.

The **Covered members** column names ${c.relatives} more people, and everybody on a
floater is a client, so the book ends up holding ${c.people}. They are family
members with no cover of their own, so the clients list shows ${c.clients} until you
tick **Include family members** — and the dashboard tiles below count
policyholders throughout. File 9 is the one that exercises this properly.

After importing with **Update records that already exist** on, the dashboard
should read:

| Tile | Value |
| --- | --- |
| Expiring this week (0–7 days) | ${c.within7} |
| Within 30 days | ${c.within30} |
| Unrenewed and expired | ${c.overdue} |
| Premium under management | ${money(c.premium)} |
| Commission expected | ${money(c.commission)} |
| Clients with no email address | ${c.noEmail} |

Renewal pipeline: Overdue ${c.overdue} · 0-7 days ${c.bucket0} · 8-15 days ${c.bucket8} ·
16-30 days ${c.bucket16} · 31-60 days ${c.bucket31} · 61-90 days ${c.bucket61}.

Renewals desk, tab by tab:

| Tab | Policies |
| --- | --- |
| Overdue | ${c.overdue} |
| Next 7 days | ${c.within7} |
| Next 30 days | ${c.within30} |
| Next 60 days | ${c.within60} |
| Next 90 days | ${c.within90} |

**Next 45 days** on the dashboard holds ${c.next45} policies but shows twelve, so the
truncation is visible.

Mix by category, counting the ${c.policies - c.overdue} active policies the way the
dashboard does:

| Category | Policies |
| --- | --- |
${categoryRows}

Of the ${c.overdue} that have already expired, ${c.expired} are inside the thirty-day
grace and read *expired*; ${c.lapsed} are past it and read *lapsed*.

The import report will say **${policies.length - new Set(policies.map((p) => p.code)).size} clients updated** even though nothing about them
changed. That is one per client who appears on more than one row: the second row
re-runs the gap-filling update, and the update counts as a change whether or not
it altered anything.

### Boundaries the data sits on

- **Expires today** — \`AB/HL/330778\` (Sandeep Kulkarni). Still active, still in the 0–7 bucket.
- **Expires tomorrow** — \`DG/MOT/220118\`. The 1-day reminder rule fires on it.
- **Exactly 30 days past expiry** — \`SH/2025/0088410\`. Reads *expired*: the grace is \`> 30\`, not \`>=\`.
- **Exactly 31 days past** — \`NIA/MOT/330912\`. Reads *lapsed*.
- **Seven days past** — \`BA/PA/117203\`. The day the seeded post-expiry rule would fire, if you activate it.
- **Reminder ladder** — one policy on each rule day: ${c.ruleDays.map(([d, n]) => `${d}d (${n})`).join(", ")}.
- **Shared policy number** — \`DUP/2026/5001\` exists under two insurers. Both are valid; the same number twice under one insurer is not.
- **Premium range** — ${money(850)} (Ajay Kumar's travel cover) to ${money(480000)} (Manish Agarwal's endowment).
- **Members** — separated with \`;\`, \`,\`, \`/\` and \`|\` on different rows, all of which the importer accepts.

## 2. Headers nobody standardised

Ten rows written the way an agency actually keeps its register: \`Customer Name\`,
\`Policy No.\`, \`Valid Till\`, \`Sum Assured\`, \`LOB\`, \`Reg No\`, \`Lives Covered\`. The
mapping screen should fill itself in and leave \`Sr No\` unmapped.

Check as you go:

- \`₹10,00,000\`, \`Rs. 24,500.50\` and \`4,410\` all read as numbers.
- \`(1,200)\` reads as **-1200** — accounting brackets mean negative.
- Dates arrive day-first, dashed, dotted, \`5-Sep-2026\`, \`5 September 1971\`, \`Mar 03, 1977\`, year-first with slashes, ISO, and as a bare Excel serial. All land on the same shape.
- \`Star Health\`, \`New India\`, \`HDFC Ergo\`, \`STAR\` and \`Oriental\` all match seeded insurers on a partial name or a short code. **Kotak Mahindra General Insurance** is not seeded, so the report should say one insurer was created.
- \`Mediclaim\`, \`Two Wheeler\`, \`Term Plan\`, \`Overseas Travel\`, \`Householder's Package\`, \`PA Cover\` and \`Cancer Care\` map onto the eight categories. \`Commercial Vehicle\` has no bucket, so it lands on **Other**.
- Row 8 leaves the category blank and the plan reads *Star Comprehensive*, so the category is taken from the plan name.
- Row 3's email reads \`raghavan[at]example.com\`; the row imports and the address is dropped.
- Row 3 has no start date, so it is back-dated 364 days from expiry.

## 3. Rows that should be refused

Run **Check without saving** first. Five rows fail and are named in *Rows needing
attention*; the rest import with something quietly dropped. The blank row never
reaches the importer — a row of empty cells is discarded while the file is read.

Then run it again with **Update records that already exist** switched **off**:
the row carrying \`SH/2026/0091823\` moves from *updated* to *skipped*.

## 4. A corrected file

Proves the four ways a row finds an existing client — code, then email, then
phone, then name — and that filling gaps never overwrites. Row 1 claims Rohit
Sharma lives in Mumbai; after the import he must still be in Pune. Row 4 carries
\`CL-00003\` with a stranger's name and email, and lands on Vikram Patel, because
the code is checked first.

Vikram Patel and Ajay Kumar both gain an email, so the no-email count drops from
${c.noEmail} to ${c.noEmail - 2}.

**Run this one last, or back up first.** Clients are gap-filled, but policies are
not: a matched policy is rewritten from the file, and every column the file does
not carry is emptied. This file has no sum insured, GST, nominee or member
columns, so the five policies it touches lose them. That asymmetry is worth
seeing once — a narrow correction file quietly strips the columns it left out.

## 5. A file missing a required column

There is no expiry column at all. The mapping panel shows **Needs Expiry date**
and refuses to run.

## 6. Tab separated

The same eight rows as the clean book in \`.tsv\` form, for the delimiter path.
Everything is already in the book, so expect ${8} updates and no new clients.

## 7. Volume

240 clients and 240 policies, codes \`CL-01000\` upward. Import this when you want
to see pagination, sorting across pages, a long city list, and how the lists
behave when they are not almost empty. Expiries are spread across 420 days, so
every bucket fills out.

## 8. A real workbook

Seven rows in a two-sheet \`.xlsx\`. The first sheet is *Read me*, so the import
screen must offer the sheet picker and you have to choose **Policies** yourself.
Dates and amounts are stored as Excel dates and numbers rather than text, except
the last row where everything is a string — both should import identically.

## 9. Families

${family.holders.length} policyholders and ${familyPolicies.length} policies whose cover lists build one deliberate
family shape. Import it and the book gains ${family.people.length} people joined by
${family.edges} relationships, every one of them named by the file, of whom ${family.dependents.length} have no cover
of their own.

The rows are ordered on purpose. **Rajesh Rangan** is a name on his father's
policy in row 1, which makes him a client there and then; row 2 gives him a
floater of his own and finds him rather than opening a second copy of him. That
is the whole reason a family member is a client — nothing had to be migrated at
the counter on the day he bought cover.

What the shape is for:

| Open | And see |
| --- | --- |
| Aarav Rangan | A family of ${family.walk("Aarav Rangan").length} read from the bottom of it: his grandfather is two steps away, and the old member table could not answer that at all |
| Rajesh Rangan | ${family.step("Rajesh Rangan").length} relatives on his page — ${label(family.step("Rajesh Rangan"))} — three policies, and a family of ${family.walk("Rajesh Rangan").length} once the walk goes past them |
| Priya Rangan | Two edges from one person, ${label(family.step("Priya Rangan"))}, from two different rows — which is why a family is edges and not a household id |
| Lakshmi Menon | Her daughter, covered on her policy as well as on her husband's. A life may be named on any policy in the family |
| Anil Kumar | Two families, wrongly. Read on |

### The sharp edge, on purpose

Rows 6 and 7 both cover somebody called **Anil Kumar**, in two families that have
nothing to do with each other. One person of that name was already in the book by
the time the second row arrived, so the importer linked to him instead of opening
a second file on him, and the two households are now one family.

That is the documented rule doing exactly what it says, and it is worth seeing
once: a cover list is a column of names, and names are not identifiers. Open Anil
Kumar, and **Unlink** the relationship that does not belong. Nothing else in the
sample data gives you a reason to unlink anything.

A name is resolved in four steps, and the order is what matters here: the holder
themselves, then somebody already related to the holder, then one unambiguous
client of that name, and only then a new person.

The second step is why importing this file twice adds nobody — each Pai is already
related to an Anil Kumar, so that match is found before the book at large is
searched. It holds even if you add another client of the same name in between.

The last step is what refuses to guess. Add **two** clients called *Anil Kumar* by
hand to an empty book, then import this file: two people already answer to that
name, so neither row chooses between them and each enters a new person instead.
Four of them, and the report says two clients were created.

### Where the relationships come from

All ${family.named} relationships are named by the file, because this one writes the word where
an agency register writes it. Every shape it might use is in here, and each is read
the same way:

| The file says | The book records |
| --- | --- |
| \`Rajesh Rangan (Son)\` | Mohan's son |
| \`Daughter - Priya Rangan\` | Lakshmi's daughter |
| \`Vasanthi Rangan\`, with **Nominee relation** *Spouse* | Mohan's spouse, taken from the nominee columns because the cover list said nothing |
| \`Self\` | The holder, not a second client of his own name |

Only a word the app knows is taken as a relationship, so a name with a bracket or a
hyphen in it survives intact. Anything unrecognised stays part of the name, and a
pair the file says nothing about reads **other** until somebody sets it.

### What a cover list cannot say

A cover list ties each life to the policyholder and to nobody else. Priya and Aarav
are both on Rajesh's floater, so she is his spouse and the boy is his son — and the
tie between the two of them is not on his page, on hers, or anywhere in the file.
Nothing guesses it. Adding it is the demonstration:

1. Open Priya Rangan, **Link a relative**, and record Aarav as **Son**. His page now
   reads *Son of* for the same relationship — one edge, read from either end, with a
   preposition rather than a guess at gender.
2. From Aarav's page, set that same relationship to **Mother**. There is still one
   relationship, now recorded the other way round; it is corrected, not contradicted.
3. From Aarav's page, try to record Mohan — his grandfather — as *his* son. It is
   refused: nobody can be their own ancestor. Only parent and child edges can
   contradict themselves this way, which is why step 4 stands.
4. Priya now holds three relationships from three sources: a husband her floater
   gave her, a mother her own policy did, and a son you added. She belongs to two
   households at once, which is the case a household id cannot hold.

Import the file again afterwards. It restates the ${family.named} relationships it named and
leaves the one you added alone — a file silent about a pair does not flatten it, and
a file that names one corrects it.

### Archive and delete stop one step out

Rajesh's page offers **Archive family** and, on delete, a choice. His immediate
family is ${family.step("Rajesh Rangan").map((n) => n.name.split(" ")[0]).join(", ")}, so:

- **Archive family** moves ${family.step("Rajesh Rangan").length + 1} people. Vasanthi and Lakshmi stay where they are, though the
  walk reaches both of them.
- **Delete this client and ${family.step("Rajesh Rangan").length} relatives** takes the same ${family.step("Rajesh Rangan").length + 1}. An in-law's own parents are
  their own household, and a delete confirmed against a list of three should not
  quietly take five.
- **Delete this client only, and keep the family** leaves all ${family.people.length - 1} of the others
  standing. It takes his relationships, not the people in them.

### Browsing, searching and counting

| Check | Expect |
| --- | --- |
| Clients list, as it opens | The ${family.holders.length} policyholders |
| Tick **Include family members** | All ${family.people.length}, the family ones badged as such |
| Search *Vasanthi* with the box unticked | She is found. A book that held her and would not admit it would be worse than one that never held her |
| Dashboard, total clients | ${family.holders.length}. Counting people would report ${family.people.length}, and every child as a client with no email address |
| Add a policy for Aarav by hand | He is in the list with the box clear, and no longer badged. Buying cover is all it took |

### Cover lists on the policy form

Open any of these policies and the lives are the holder and the people related to
them, and nobody else. Rajesh's motor policy covers only him, though his family
panel is full — a cover list is per policy. Try the form on Ganesh Pai before you
unlink, and Sunil Pai is offered, which is the same wrong join seen from the other
side.

## Reminders

The clean book puts exactly one policy on each active rule day, so the ladder
has something to find the moment it is switched on:

| Rule | Policy | Client |
| --- | --- | --- |
| 60 days before expiry | \`NB/RA2/119006\` | Meera Iyer |
| 30 days before expiry | \`CH/2026/771203\` | Priya Menon |
| 15 days before expiry | \`HE/PAS/700904\` | Kavita Joshi |
| 7 days before expiry | \`TA/TG/908771\` | Suresh Nair |
| 1 day before expiry | \`DG/MOT/220118\` | Arjun Reddy |
| 7 days after expiry (seeded off) | \`BA/PA/117203\` | Harpreet Singh |

All five have an email address on file, so a plan should show five due today. Tick
**Do not send reminders** on Kavita Joshi and it becomes four to send and one
recorded as skipped — recorded once, not retried on every sweep.

Turn the post-expiry rule on and Harpreet Singh's accident cover joins them.
Renew Arjun Reddy's motor policy and the reminder queued against it is
cancelled rather than sent.

With the expiring-soon window left at 30, the daily digest covers ${c.within30}
policies.

## Worth trying alongside the files

**Download template** on the import screen, fill in a row, and import it back.
The template writes its own field labels as the headers, and \`Commission %\`
normalises to \`commission\`, which is the exact synonym for the commission
*amount*. So the percentage lands in the amount column, \`Commission amount\` is
left unmapped, and the commission rate never arrives at all. Any file whose
header reads *Commission %* has the same problem; \`Commission rate\` maps
correctly, which is what the clean book uses.

## What import cannot reach

These are the states no spreadsheet can create. Set them by hand once the book
is loaded.

| Do this | To test |
| --- | --- |
| Open Kavita Joshi and tick **Do not send reminders** | The opt-out badge, and her exclusion from **Copy emails** |
| Archive Om Prakash Yadav | The archived badge, **Include archived**, and his absence from the default list |
| Delete a volume client | The cascade — their policies go too |
| Renew \`SH/2026/0091823\`, then renew the result | A three-year chain, the history dialog, and the previous years reading *renewed* |
| Renew something in the overdue tab | The tab emptying by one, and the reminder queued against it being cancelled |
| Try to delete Star Health in **Insurers & plans** | The refusal — an insurer holding policies can only be deactivated |
| Deactivate Acko, then tick **Show inactive** | Both halves of the insurer list |
| Link a relative to a client, then tick them on one of their policies | The cover list on the policy form, which offers the holder and their family and nobody else |
| Set the relationships on the family in file 9, then archive and delete it | The words read from either end, the ancestry refusal, and both delete scopes |
| Settings → fill in the SMTP block, save a password, then **Send test** | The mail path, without touching a client |
| Settings → turn **Dry run** off, then run the reminders | Sending for real, against the rehearsal |
| Reminders → turn a rule off and plan again | The ladder shortening by one |
| Reminders → **Everything that has gone out** | The log, and retrying or cancelling a row |
| Settings → set an expiring-soon window of 7, then plan again | The digest window |
| **Back up now**, then check the backup folder | Backups and retention |
| Export from all three screens with filters applied | That the export follows the filters, in both \`.xlsx\` and \`.csv\` |

Cancelling a policy has no control on any screen. \`set_policy_status\` exists in
the API and the status is in the schema, but nothing in the interface calls it,
so \`cancelled\` cannot be reached by hand today.
`;
}

// -------------------------------------------------------------------- main ---

mkdirSync(OUT, { recursive: true });

const bookRows = policies.map((policy) => bookRow(policy));
const files = [];

files.push([write("01-clean-book.csv", delimited(BOOK_HEADERS, bookRows, ",")),
  "The main book — every category, every renewal window, every status the calendar can produce"]);
files.push([write("02-messy-headers.csv", delimited(MESSY_HEADERS, messyRows(), ",")),
  "Column names and value formats the app has to guess at"]);

const brokenHeaders = ["Client name", "Client code", "Email", "Mobile", "Policy number", "Insurer",
  "Plan", "Category", "Start date", "Expiry date", "Sum insured", "Premium", "GST", "Notes"];
files.push([write("03-broken-rows.csv", delimited(brokenHeaders,
  brokenRows().map((r) => [r.name, r.code, r.email, r.phone, r.number, r.insurer, r.plan, r.category,
    r.start, r.expiry, r.si, r.premium, r.gst, r.notes]), ",")),
  "Rows that must be reported rather than saved"]);

const correctionHeaders = ["Client name", "Client code", "Email", "Mobile", "City", "Policy number",
  "Insurer", "Premium", "Expiry date", "Notes"];
files.push([write("04-corrections.csv", delimited(correctionHeaders,
  correctionRows().map((r) => [r.name, r.code, r.email, r.phone, r.city, r.number, r.insurer,
    r.premium, r.expiry, r.notes]), ",")),
  "A re-import that matches existing clients four different ways and fills their gaps"]);

const withoutExpiry = BOOK_HEADERS.filter((h) => h !== "Expiry date");
const expiryIndex = BOOK_HEADERS.indexOf("Expiry date");
files.push([write("05-missing-expiry-column.csv", delimited(withoutExpiry,
  bookRows.slice(0, 6).map((row) => row.filter((_, i) => i !== expiryIndex)), ",")),
  "A file with no expiry column, which the import screen has to refuse"]);

files.push([write("06-clean-book.tsv", delimited(BOOK_HEADERS, bookRows.slice(0, 8), "\t")),
  "Eight rows of the clean book, tab separated"]);

files.push([write("07-volume.csv", delimited(BOOK_HEADERS, volumeRows(), ",")),
  "240 more clients, for pagination, sorting and a book that is not almost empty"]);

writeFileSync(join(OUT, "08-workbook.xlsx"), workbook([
  { name: "Read me", rows: [["This sheet is a decoy."], ["Choose the Policies sheet on the import screen."]] },
  { name: "Policies", rows: workbookRows() },
]));
files.push(["08-workbook.xlsx", "A two-sheet Excel file with real dates and real numbers, so the sheet picker has something to pick"]);

const codeColumn = BOOK_HEADERS.indexOf("Client code");
files.push([write("09-families.csv", delimited(BOOK_HEADERS,
  familyPolicies.map((p) => bookRow(p, familyClients).map((cell, i) => (i === codeColumn ? "" : cell))), ",")),
  "Three generations, a relative who belongs to two households, and two families joined by a name common enough to catch the importer out"]);

writeFileSync(join(OUT, "README.md"), readme(files));

const c = counts();
console.log(`sample-data/ written for ${iso(0)}`);
console.log(`  ${c.clients} policyholders and ${c.policies} policies in the clean book, whose cover lists name ${c.relatives} more people`);
console.log(`  ${family.people.length} people in ${family.edges} relationships in the families file, 240 more clients in the volume file`);
console.log(`  ${files.length + 1} files including the README`);
