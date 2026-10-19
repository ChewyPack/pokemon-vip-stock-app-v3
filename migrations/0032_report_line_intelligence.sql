-- Add line-report fields to the existing report stream.
-- Apply this migration to the STAGING D1 database before testing the line form.
ALTER TABLE reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'stock';
ALTER TABLE reports ADD COLUMN line_count INTEGER;
ALTER TABLE reports ADD COLUMN stocked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_report_type_created_at
ON reports (report_type, created_at);
