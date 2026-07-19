const { pool } = require('../db');

async function createSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Enable uuid extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // Enums
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          CREATE TYPE user_role AS ENUM ('admin','staff','cashier');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_type') THEN
          CREATE TYPE customer_type AS ENUM ('online','walk-in');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_type') THEN
          CREATE TYPE supplier_type AS ENUM ('online','physical','both');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_status') THEN
          CREATE TYPE product_status AS ENUM ('active','archived');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_movement_type') THEN
          CREATE TYPE inventory_movement_type AS ENUM ('sale','restock','return','transfer','adjustment');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
          CREATE TYPE order_status AS ENUM ('pending','partially_paid','paid','packed','shipped','completed','cancelled','returned');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
          CREATE TYPE payment_method AS ENUM ('cash','gcash','bank_transfer','card','cod');
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gcash_service_type') THEN
          CREATE TYPE gcash_service_type AS ENUM ('cash_in','cash_out');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prepaid_load_carrier') THEN
          CREATE TYPE prepaid_load_carrier AS ENUM ('smart','tnt','globe','tm','dito','gomo','sun');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_status') THEN
          CREATE TYPE return_status AS ENUM ('pending','approved','rejected');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
          CREATE TYPE purchase_order_status AS ENUM ('draft','estimated','ordered','received','cancelled');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_deposit_status') THEN
          CREATE TYPE bank_deposit_status AS ENUM ('posted','reversed');
        END IF;
      END$$;
    `);

    // Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        branch_name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(50),
        is_main BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sales_channels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        channel_name VARCHAR(255) NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        full_name VARCHAR(255),
        phone VARCHAR(100) UNIQUE,
        email VARCHAR(255),
        password_hash TEXT,
        role user_role NOT NULL DEFAULT 'staff',
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255),
        address TEXT,
        customer_type customer_type DEFAULT 'walk-in',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        supplier_name VARCHAR(255),
        phone VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        address TEXT,
        supplier_type supplier_type DEFAULT 'physical',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        category_name VARCHAR(255),
        parent_id UUID REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_name VARCHAR(255),
        description TEXT,
        photo_url TEXT,
        category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
        brand VARCHAR(255),
        status product_status DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS product_variants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        sku VARCHAR(255) UNIQUE,
        class VARCHAR(100),
        product_type VARCHAR(100),
        brand VARCHAR(255),
        photo_url TEXT,
        size VARCHAR(100),
        color VARCHAR(100),
        price NUMERIC(12,2) DEFAULT 0,
        cost_price NUMERIC(12,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS inventories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
        product_variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
        quantity_on_hand INTEGER DEFAULT 0,
        reorder_level INTEGER DEFAULT 0,
        UNIQUE(branch_id, product_variant_id)
      );

      CREATE TABLE IF NOT EXISTS inventory_movements (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        product_variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
        movement_type inventory_movement_type NOT NULL,
        quantity INTEGER NOT NULL,
        reference_type VARCHAR(255),
        reference_id UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_number VARCHAR(255) UNIQUE,
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        sales_channel_id UUID REFERENCES sales_channels(id) ON DELETE SET NULL,
        order_status order_status DEFAULT 'pending',
        total_amount NUMERIC(12,2) DEFAULT 0,
        discount_percentage NUMERIC(5,2) DEFAULT 0,
        discount_amount NUMERIC(12,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        product_variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price NUMERIC(12,2) DEFAULT 0,
        subtotal NUMERIC(12,2) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        payment_method payment_method NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        received_by UUID REFERENCES users(id) ON DELETE SET NULL,
        payment_date TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS gcash_fee_rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        service_type gcash_service_type NOT NULL,
        min_amount NUMERIC(12,2) NOT NULL CHECK (min_amount >= 0),
        max_amount NUMERIC(12,2) CHECK (max_amount IS NULL OR max_amount >= min_amount),
        fee_amount NUMERIC(12,2) NOT NULL CHECK (fee_amount >= 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        effective_from TIMESTAMP WITH TIME ZONE,
        effective_to TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS gcash_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        service_type gcash_service_type NOT NULL,
        principal_amount NUMERIC(12,2) NOT NULL CHECK (principal_amount > 0),
        fee_amount NUMERIC(12,2) NOT NULL CHECK (fee_amount >= 0),
        gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0),
        cash_impact NUMERIC(12,2) NOT NULL,
        reference_number VARCHAR(255) NOT NULL,
        fee_rule_id UUID REFERENCES gcash_fee_rules(id) ON DELETE SET NULL,
        received_by UUID REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS ux_gcash_transactions_reference_number
        ON gcash_transactions(reference_number);

      CREATE INDEX IF NOT EXISTS ix_gcash_fee_rules_lookup
        ON gcash_fee_rules(service_type, is_active, min_amount, max_amount);

      CREATE TABLE IF NOT EXISTS prepaid_load_products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        carrier prepaid_load_carrier NOT NULL,
        product_code VARCHAR(120) NOT NULL UNIQUE,
        product_name VARCHAR(255) NOT NULL,
        description TEXT,
        load_type VARCHAR(50) NOT NULL DEFAULT 'regular',
        face_value NUMERIC(12,2) NOT NULL CHECK (face_value > 0),
        markup_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (markup_amount >= 0),
        validity_days INTEGER CHECK (validity_days IS NULL OR validity_days > 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        source_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prepaid_load_transactions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        recipient_mobile_no VARCHAR(20) NOT NULL,
        carrier prepaid_load_carrier NOT NULL,
        product_id UUID NOT NULL REFERENCES prepaid_load_products(id) ON DELETE RESTRICT,
        face_value NUMERIC(12,2) NOT NULL CHECK (face_value > 0),
        markup_amount NUMERIC(12,2) NOT NULL CHECK (markup_amount >= 0),
        gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount > 0),
        cash_impact NUMERIC(12,2) NOT NULL,
        reference_number VARCHAR(255) NOT NULL,
        received_by UUID REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS ux_prepaid_load_transactions_reference_number
        ON prepaid_load_transactions(reference_number);

      CREATE INDEX IF NOT EXISTS ix_prepaid_load_products_carrier_active
        ON prepaid_load_products(carrier, is_active, face_value);

      CREATE TABLE IF NOT EXISTS returns (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        reason TEXT,
        return_status return_status DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS return_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        return_id UUID REFERENCES returns(id) ON DELETE CASCADE,
        product_variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        supplier_id UUID NOT NULL REFERENCES suppliers(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        po_number VARCHAR(50) NOT NULL UNIQUE,
        status VARCHAR(30) NOT NULL CHECK (status IN ('draft','estimated','ordered','received','cancelled')),
        total_cost NUMERIC(12,2),
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
        tipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
        miscellaneous_cost NUMERIC(12,2) NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        cost_price NUMERIC(12,2) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS purchase_order_estimates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        estimated_quantity INTEGER NOT NULL CHECK (estimated_quantity > 0),
        estimated_total_cost NUMERIC(12,2) NOT NULL CHECK (estimated_total_cost >= 0),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        expense_type VARCHAR(255),
        description TEXT,
        amount NUMERIC(12,2) DEFAULT 0,
        expense_date DATE
      );

      CREATE TABLE IF NOT EXISTS cash_reconciliations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        business_date DATE NOT NULL,
        opening_cash_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        closing_cash_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        opening_cash_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        closing_cash_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_sales_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        cash_sales_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        other_cash_impact_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        gcash_cash_in_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        gcash_cash_out_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_cash_on_hand NUMERIC(12,2) NOT NULL DEFAULT 0,
        actual_cash_on_hand NUMERIC(12,2) NOT NULL DEFAULT 0,
        variance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        is_short BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
        closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        opened_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        closed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        UNIQUE(branch_id, business_date)
      );

      CREATE INDEX IF NOT EXISTS ix_cash_reconciliations_branch_date
        ON cash_reconciliations(branch_id, business_date DESC);

      CREATE TABLE IF NOT EXISTS bank_deposits (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        cash_reconciliation_id UUID REFERENCES cash_reconciliations(id) ON DELETE SET NULL,
        business_date DATE NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount <> 0),
        bank_account VARCHAR(255) NOT NULL,
        reference_number VARCHAR(255) NOT NULL,
        depositor_name VARCHAR(255) NOT NULL,
        photo_proof_url TEXT NOT NULL,
        status bank_deposit_status NOT NULL DEFAULT 'posted',
        reversal_of_id UUID REFERENCES bank_deposits(id) ON DELETE RESTRICT,
        reversal_reason TEXT,
        reversed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reversed_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        deposited_by UUID REFERENCES users(id) ON DELETE SET NULL,
        deposited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS ix_bank_deposits_branch_business_date
        ON bank_deposits(branch_id, business_date DESC);

      CREATE INDEX IF NOT EXISTS ix_bank_deposits_reconciliation
        ON bank_deposits(cash_reconciliation_id);

      CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_deposits_reference_number
        ON bank_deposits(reference_number);

      CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_deposits_reversal_of_id
        ON bank_deposits(reversal_of_id)
        WHERE reversal_of_id IS NOT NULL;
    `);

    // add photo_url to products if missing (safe for existing DBs)
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
    // add discount fields to orders if missing (safe for existing DBs)
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC(5,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0;`);

    // add is_active to product_variants if missing (safe for existing DBs)
    await client.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
    // add photo_url to product_variants if missing (safe for existing DBs)
    await client.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS photo_url TEXT;`);

    // Normalize FK behavior for historical movement preservation on variant deletion.
    await client.query(`ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_product_variant_id_fkey;`);
    await client.query(`
      ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_product_variant_id_fkey
      FOREIGN KEY (product_variant_id)
      REFERENCES product_variants(id)
      ON DELETE SET NULL;
    `);

    // add GCash tables/columns/indexes for existing DBs where table may already exist without latest columns
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS service_type gcash_service_type;`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS min_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS max_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);
    await client.query(`ALTER TABLE gcash_fee_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);

    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS service_type gcash_service_type;`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS principal_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS cash_impact NUMERIC(12,2);`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS reference_number VARCHAR(255);`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS fee_rule_id UUID REFERENCES gcash_fee_rules(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await client.query(`ALTER TABLE gcash_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_gcash_transactions_reference_number ON gcash_transactions(reference_number);`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_gcash_fee_rules_lookup ON gcash_fee_rules(service_type, is_active, min_amount, max_amount);`);

    // add prepaid load tables/columns/indexes for existing DBs
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS carrier prepaid_load_carrier;`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS product_code VARCHAR(120);`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS product_name VARCHAR(255);`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS description TEXT;`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS load_type VARCHAR(50) DEFAULT 'regular';`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS face_value NUMERIC(12,2);`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS markup_amount NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS validity_days INTEGER;`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS source_url TEXT;`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);
    await client.query(`ALTER TABLE prepaid_load_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);

    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS recipient_mobile_no VARCHAR(20);`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS carrier prepaid_load_carrier;`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES prepaid_load_products(id) ON DELETE RESTRICT;`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS face_value NUMERIC(12,2);`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS markup_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS cash_impact NUMERIC(12,2);`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS reference_number VARCHAR(255);`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await client.query(`ALTER TABLE prepaid_load_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_prepaid_load_products_product_code ON prepaid_load_products(product_code);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_prepaid_load_transactions_reference_number ON prepaid_load_transactions(reference_number);`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_prepaid_load_products_carrier_active ON prepaid_load_products(carrier, is_active, face_value);`);

    // add cash_reconciliations columns for existing DBs that were created before this feature
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS business_date DATE;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS opening_cash_breakdown JSONB DEFAULT '[]'::jsonb;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS closing_cash_breakdown JSONB DEFAULT '[]'::jsonb;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS opening_cash_total NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS closing_cash_total NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS total_sales_amount NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS cash_sales_amount NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS other_cash_impact_amount NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS gcash_cash_in_total NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS gcash_cash_out_total NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS expected_cash_on_hand NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS actual_cash_on_hand NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS variance_amount NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS is_short BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS opened_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);
    await client.query(`ALTER TABLE cash_reconciliations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_reconciliations_branch_date ON cash_reconciliations(branch_id, business_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_cash_reconciliations_branch_date ON cash_reconciliations(branch_id, business_date DESC);`);

    // add bank_deposits columns for existing DBs that predate audit-trail updates
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS cash_reconciliation_id UUID REFERENCES cash_reconciliations(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS business_date DATE;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS bank_account VARCHAR(255);`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS reference_number VARCHAR(255);`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS depositor_name VARCHAR(255);`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS photo_proof_url TEXT;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS status bank_deposit_status DEFAULT 'posted';`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES bank_deposits(id) ON DELETE RESTRICT;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS reversal_reason TEXT;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS deposited_by UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS deposited_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);
    await client.query(`ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();`);

    await client.query(`UPDATE bank_deposits SET bank_account = COALESCE(NULLIF(bank_account, ''), 'Unspecified') WHERE bank_account IS NULL OR bank_account = '';`);
    await client.query(`UPDATE bank_deposits SET reference_number = COALESCE(NULLIF(reference_number, ''), CONCAT('LEGACY-', id::text)) WHERE reference_number IS NULL OR reference_number = '';`);
    await client.query(`UPDATE bank_deposits SET depositor_name = COALESCE(NULLIF(depositor_name, ''), 'Unspecified') WHERE depositor_name IS NULL OR depositor_name = '';`);
    await client.query(`UPDATE bank_deposits SET photo_proof_url = COALESCE(NULLIF(photo_proof_url, ''), 'legacy://not-provided') WHERE photo_proof_url IS NULL OR photo_proof_url = '';`);
    await client.query(`UPDATE bank_deposits SET business_date = CURRENT_DATE WHERE business_date IS NULL;`);
    await client.query(`UPDATE bank_deposits SET status = 'posted' WHERE status IS NULL;`);

    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN branch_id SET NOT NULL;`);
    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN business_date SET NOT NULL;`);
    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN amount SET NOT NULL;`);
    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN bank_account SET NOT NULL;`);
    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN reference_number SET NOT NULL;`);
    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN depositor_name SET NOT NULL;`);
    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN photo_proof_url SET NOT NULL;`);
    await client.query(`ALTER TABLE bank_deposits ALTER COLUMN status SET NOT NULL;`);

    await client.query(`ALTER TABLE bank_deposits DROP CONSTRAINT IF EXISTS bank_deposits_amount_check;`);
    await client.query(`ALTER TABLE bank_deposits ADD CONSTRAINT bank_deposits_amount_check CHECK (amount <> 0);`);

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_deposits_reference_number ON bank_deposits(reference_number);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_deposits_reversal_of_id ON bank_deposits(reversal_of_id) WHERE reversal_of_id IS NOT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_bank_deposits_branch_business_date ON bank_deposits(branch_id, business_date DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_bank_deposits_reconciliation ON bank_deposits(cash_reconciliation_id);`);

    await client.query('COMMIT');
    console.log('Schema initialization complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating schema:', err.message || err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createSchema };
