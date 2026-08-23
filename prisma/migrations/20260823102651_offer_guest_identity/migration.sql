-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "guestSessionToken" VARCHAR(64);

-- CreateIndex
CREATE INDEX "Offer_guestSessionToken_idx" ON "Offer"("guestSessionToken");
