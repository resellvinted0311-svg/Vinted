-- DropIndex
DROP INDEX "ArticleTranslation_searchVector_idx";

-- DropIndex
DROP INDEX "Order_lockOwnerId_status_idx";

-- DropIndex
DROP INDEX "ShippingZone_countries_idx";

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "descriptionIsGenerated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ArticleImage" ADD COLUMN     "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "ArticleTranslation" ADD COLUMN     "isFallback" BOOLEAN NOT NULL DEFAULT false;
