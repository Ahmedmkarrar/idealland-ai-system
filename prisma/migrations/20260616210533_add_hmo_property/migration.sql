-- CreateTable
CREATE TABLE "HmoProperty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "council" TEXT NOT NULL,
    "licenceNumber" TEXT,
    "licenceType" TEXT,
    "status" TEXT,
    "propertyAddress" TEXT NOT NULL,
    "postcode" TEXT,
    "holderName" TEXT,
    "holderAddress" TEXT,
    "managerName" TEXT,
    "managerAddress" TEXT,
    "maxPersons" INTEGER,
    "storeys" INTEGER,
    "bedrooms" INTEGER,
    "rooms" INTEGER,
    "commencementDate" DATETIME,
    "endDate" DATETIME,
    "latitude" REAL,
    "longitude" REAL,
    "ownerType" TEXT,
    "portfolioSize" INTEGER NOT NULL DEFAULT 1,
    "sellLikelihood" INTEGER,
    "sellReason" TEXT,
    "flags" TEXT,
    "intelligenceSummary" TEXT,
    "analyzedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "HmoProperty_externalKey_key" ON "HmoProperty"("externalKey");

-- CreateIndex
CREATE INDEX "HmoProperty_council_idx" ON "HmoProperty"("council");

-- CreateIndex
CREATE INDEX "HmoProperty_holderName_idx" ON "HmoProperty"("holderName");

-- CreateIndex
CREATE INDEX "HmoProperty_sellLikelihood_idx" ON "HmoProperty"("sellLikelihood");
