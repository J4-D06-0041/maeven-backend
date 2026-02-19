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
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_status') THEN
          CREATE TYPE return_status AS ENUM ('pending','approved','rejected');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
          CREATE TYPE purchase_order_status AS ENUM ('draft','estimated','ordered','received','cancelled');
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
