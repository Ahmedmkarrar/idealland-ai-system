import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { addContact } from "@/lib/services/mailing";

const SAMPLE_CONTACTS = [
  { name: "James Harrison", email: "j.harrison@hcarchitects.co.uk", company: "HC Architects", type: "architect" as const, tags: ["london", "residential"] },
  { name: "Sarah Mitchell", email: "s.mitchell@urbandev.co.uk", company: "Urban Developments Ltd", type: "developer" as const, tags: ["london", "large-scale"] },
  { name: "David Chen", email: "d.chen@propertyinvest.com", company: "Property Invest Group", type: "investor" as const, tags: ["london"] },
  { name: "Emma Thompson", email: "e.thompson@tdesign.co.uk", company: "T Design Studio", type: "architect" as const, tags: ["residential"] },
  { name: "Michael Brown", email: "m.brown@londonbuild.com", company: "London Build Co", type: "developer" as const, tags: ["london", "small-scale"] },
  { name: "Priya Sharma", email: "p.sharma@blueprintarch.co.uk", company: "Blueprint Architecture", type: "architect" as const, tags: ["london", "residential"] },
  { name: "Tom Wilson", email: "t.wilson@capitalland.com", company: "Capital Land Partners", type: "investor" as const, tags: ["large-scale"] },
  { name: "Laura Davies", email: "l.davies@studio44.co.uk", company: "Studio 44", type: "architect" as const, tags: ["residential"] },
  { name: "Robert King", email: "r.king@kingdev.co.uk", company: "King Developments", type: "developer" as const, tags: ["london"] },
  { name: "Anna Foster", email: "a.foster@folio.co.uk", company: "Folio Architecture", type: "architect" as const, tags: ["london", "residential"] },
];

export async function POST() {
  const existingContacts = await prisma.mailingContact.count();
  if (existingContacts > 0) {
    return NextResponse.json({ message: "Contacts already loaded" });
  }

  for (const contact of SAMPLE_CONTACTS) {
    await addContact(contact);
  }

  return NextResponse.json({
    success: true,
    message: `Loaded ${SAMPLE_CONTACTS.length} sample contacts into mailing list. Run a council scan to get real planning data.`,
  });
}
