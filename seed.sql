-- Demo data (optional)
INSERT INTO table_tokens (table_name, token, active)
VALUES ('Table 1', 'TBL1vA9qWb3kS7x2pL0mZn', 1),
       ('Table 2', 'TBL2vA9qWb3kS7x2pL0mZn', 1);

INSERT INTO categories (name, sort_order) VALUES
 ('Coffee', 1), ('Tea', 2), ('Soft Drinks', 3), ('Snacks', 4);

INSERT INTO products (category_id, name, price, sort_order) VALUES
 (1, 'Espresso', 2.50, 1),
 (1, 'Cappuccino', 3.20, 2),
 (1, 'Latte', 3.50, 3),
 (2, 'Green Tea', 2.80, 1),
 (2, 'Black Tea', 2.60, 2),
 (3, 'Cola 330ml', 2.40, 1),
 (4, 'Croissant', 1.90, 1),
 (4, 'Muffin', 2.10, 2);
