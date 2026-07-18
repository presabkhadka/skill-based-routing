-- Drop the dead `rawText` column (only ever used by the removed AI intake path).
ALTER TABLE "ServiceRequest" DROP COLUMN "rawText";
