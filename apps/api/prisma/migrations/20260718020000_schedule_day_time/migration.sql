-- Schedule a request by day-of-week + time (the granularity the shift gate uses)
-- instead of a full calendar datetime.
ALTER TABLE "ServiceRequest" DROP COLUMN "scheduledFor";
ALTER TABLE "ServiceRequest" ADD COLUMN "scheduledDay" INTEGER;
ALTER TABLE "ServiceRequest" ADD COLUMN "scheduledTime" TEXT;
