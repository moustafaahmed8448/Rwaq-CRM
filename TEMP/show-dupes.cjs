// Prints the duplicate report so the detection rules can be eyeballed against
// real data before anyone is offered a destructive merge button.
const d = require("./dup.json");

console.log(`groups=${d.groupCount}  clients involved=${d.clientCount}`);

const byReason = { phone: 0, name: 0 };
for (const g of d.groups) byReason[g.reason] += 1;
console.log(`  phone matches: ${byReason.phone}`);
console.log(`  name-only matches: ${byReason.name}`);

console.log("\nFirst 12 groups:");
for (const g of d.groups.slice(0, 12)) {
  const names = g.clients.map((c) => `#${c.id} ${c.name}`).join("  |  ");
  console.log(`  [${g.reason}] key=${g.key}`);
  console.log(`      ${names}`);
  for (const c of g.clients) {
    console.log(`      #${c.id} phone=${c.phoneNumber} status=${c.status} project=${(c.project || "-").slice(0, 28)} notes=${(c.notes || "-").slice(0, 28)}`);
  }
}