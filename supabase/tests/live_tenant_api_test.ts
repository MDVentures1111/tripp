const names = ["TRIPP_TEST_SUPABASE_URL","TRIPP_TEST_ANON_KEY","TRIPP_TEST_USER_A_JWT","TRIPP_TEST_USER_B_JWT","TRIPP_TEST_DEAL_A_ID","TRIPP_TEST_DEAL_B_ID"];
const values = names.map((name) => { const value = Deno.env.get(name); if (!value) throw new Error("Missing " + name); return value; });
const [base,key,jwtA,jwtB,dealA,dealB] = values;
if (jwtA === jwtB || dealA === dealB) throw new Error("Two distinct test users and deals required");
async function lookup(jwt: string, id: string) {
  const url = new URL("/rest/v1/deals", base);
  url.searchParams.set("select","id,organization_id");
  url.searchParams.set("id","eq." + id);
  const response = await fetch(url, {headers:{apikey:key,Authorization:"Bearer "+jwt}});
  if (!response.ok) throw new Error("API status "+response.status);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Invalid response");
  return rows;
}
const ownOrganizations: string[] = [];
for (const [label,jwt,own,other] of [["A",jwtA,dealA,dealB],["B",jwtB,dealB,dealA]]) {
  const ownRows = await lookup(jwt,own);
  if (ownRows.length !== 1 || ownRows[0].id !== own) throw new Error(label+" cannot read own deal");
  if (typeof ownRows[0].organization_id !== "string") throw new Error(label+" missing organization ID");
  ownOrganizations.push(ownRows[0].organization_id);
  const otherRows = await lookup(jwt,other);
  if (otherRows.length !== 0) throw new Error(label+" can read foreign deal");
  console.log(label+": own deal visible, foreign deal hidden");
}
if (ownOrganizations[0] === ownOrganizations[1]) throw new Error("Test accounts belong to the same deal organization; isolation not established");
console.log("PASS: authenticated PostgREST tenant isolation across distinct organizations");
