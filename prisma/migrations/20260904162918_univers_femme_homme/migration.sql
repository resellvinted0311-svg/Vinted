-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "audience" TEXT;

-- CreateIndex
CREATE INDEX "Article_status_audience_publishedAt_idx" ON "Article"("status", "audience", "publishedAt");
