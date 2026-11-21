-- Runs once, on the first start of an empty Postgres volume.
-- The main database (certiflow) is created by POSTGRES_DB; tests get their own.
CREATE DATABASE certiflow_test;
