"""
Confirms SQL→IR conversion for every query in the company template
(frontend/lib/database/company-template.json).

All 24 queries are expected to parse successfully and produce a valid QueryIR.
This acts as a regression registry — if a query breaks, the test catches it.
"""
import pytest
from sql_ir import parse_sql_to_ir

QUERIES = [
    (
        "Average Order Value",
        """
        SELECT
          DATE_TRUNC('week', created_at) as week_start,
          AVG(total) as avg_order_value
        FROM orders
        GROUP BY DATE_TRUNC('week', created_at)
        ORDER BY week_start
        """,
    ),
    (
        "Weekly Orders and Revenue",
        """
        SELECT
          DATE_TRUNC('week', created_at) as week,
          COUNT(*) as orders,
          SUM(total) as revenue
        FROM orders
        GROUP BY DATE_TRUNC('week', created_at)
        ORDER BY week
        """,
    ),
    (
        "Weekly Revenue by Product Category",
        """
        SELECT
          DATE_TRUNC('week', o.created_at) as week_start,
          pc.category_name,
          SUM(oi.total_price) as revenue
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN products p ON oi.product_id = p.product_id
        JOIN product_subcategories ps ON p.subcategory_id = ps.subcategory_id
        JOIN product_categories pc ON ps.category_id = pc.category_id
        WHERE o.status = 'completed'
        GROUP BY DATE_TRUNC('week', o.created_at), pc.category_name
        ORDER BY week_start, category_name
        """,
    ),
    (
        "Orders by Day of Week and Hour",
        """
        WITH hourly_counts AS (
          SELECT
            DATE_TRUNC('day', created_at) as order_date,
            CASE DAYOFWEEK(created_at)
              WHEN 0 THEN 'Sunday'
              WHEN 1 THEN 'Monday'
              WHEN 2 THEN 'Tuesday'
              WHEN 3 THEN 'Wednesday'
              WHEN 4 THEN 'Thursday'
              WHEN 5 THEN 'Friday'
              WHEN 6 THEN 'Saturday'
            END as day_of_week,
            CASE
              WHEN EXTRACT(HOUR FROM created_at) >= 0 AND EXTRACT(HOUR FROM created_at) < 6 THEN '0-6 (Early Morning)'
              WHEN EXTRACT(HOUR FROM created_at) >= 6 AND EXTRACT(HOUR FROM created_at) < 12 THEN '6-12 (Morning)'
              WHEN EXTRACT(HOUR FROM created_at) >= 12 AND EXTRACT(HOUR FROM created_at) < 18 THEN '12-18 (Afternoon)'
              WHEN EXTRACT(HOUR FROM created_at) >= 18 THEN '18-24 (Evening)'
            END as hour_range,
            COUNT(*) as order_count
          FROM orders
          WHERE status = 'completed'
            AND created_at >= '2025-12-01'
          GROUP BY order_date, day_of_week, hour_range
        )
        SELECT
          day_of_week,
          hour_range,
          ROUND(AVG(order_count), 1) as avg_orders
        FROM hourly_counts
        GROUP BY day_of_week, hour_range
        ORDER BY
          CASE day_of_week
            WHEN 'Monday' THEN 1
            WHEN 'Tuesday' THEN 2
            WHEN 'Wednesday' THEN 3
            WHEN 'Thursday' THEN 4
            WHEN 'Friday' THEN 5
            WHEN 'Saturday' THEN 6
            WHEN 'Sunday' THEN 7
          END,
          CASE hour_range
            WHEN '0-6 (Early Morning)' THEN 1
            WHEN '6-12 (Morning)' THEN 2
            WHEN '12-18 (Afternoon)' THEN 3
            WHEN '18-24 (Evening)' THEN 4
          END
        """,
    ),
    (
        "Total Monthly Orders",
        """
        SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as orders
        FROM orders
        WHERE status = 'completed'
        GROUP BY 1
        ORDER BY 1
        """,
    ),
    (
        "Monthly Revenue",
        """
        SELECT DATE_TRUNC('month', created_at) as month, ROUND(SUM(total), 2) as revenue
        FROM orders
        WHERE status = 'completed'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month
        """,
    ),
    (
        "Monthly Active Users",
        """
        SELECT DATE_TRUNC('month', created_at) as month, COUNT(DISTINCT user_id) as active_users
        FROM orders
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month
        """,
    ),
    (
        "Weekly Active Users",
        """
        WITH weekly_new_users AS (
          SELECT
            DATE_TRUNC('week', created_at) as week,
            COUNT(*) as new_users
          FROM users
          GROUP BY DATE_TRUNC('week', created_at)
        ),
        weekly_returning_users AS (
          SELECT
            DATE_TRUNC('week', o.created_at) as week,
            COUNT(DISTINCT o.user_id) as returning_users
          FROM orders o
          JOIN users u ON o.user_id = u.user_id
          WHERE DATE_TRUNC('week', o.created_at) > DATE_TRUNC('week', u.created_at)
          GROUP BY DATE_TRUNC('week', o.created_at)
        )
        SELECT
          COALESCE(n.week, r.week) as week,
          COALESCE(n.new_users, 0) as new_users,
          COALESCE(r.returning_users, 0) as returning_users
        FROM weekly_new_users n
        FULL OUTER JOIN weekly_returning_users r ON n.week = r.week
        ORDER BY week
        """,
    ),
    (
        "User Distribution by Subscription Status",
        """
        SELECT
          CASE
            WHEN us.subscription_id IS NOT NULL THEN 'Subscriber'
            ELSE 'Non-Subscriber'
          END as user_type,
          COUNT(DISTINCT u.user_id) as user_count
        FROM users u
        LEFT JOIN user_subscriptions us ON u.user_id = us.user_id
          AND us.status = 'active'
          AND us.started_at <= '2025-12-01'
          AND (us.ended_at IS NULL OR us.ended_at >= '2025-12-01')
        GROUP BY user_type
        ORDER BY user_count DESC
        """,
    ),
    (
        "Revenue by Platform",
        """
        SELECT
          platform,
          ROUND(SUM(total), 2) as revenue
        FROM orders
        WHERE status = 'completed'
          AND created_at >= '2025-12-01'
          AND created_at < '2026-01-01'
        GROUP BY platform
        ORDER BY revenue DESC
        """,
    ),
    (
        "Top 5 Zones by Revenue",
        """
        SELECT
          z.zone_name,
          ROUND(SUM(o.total), 2) as revenue
        FROM orders o
        JOIN zones z ON o.zone_id = z.zone_id
        WHERE o.status = 'completed'
          AND o.created_at >= '2025-12-01'
          AND o.created_at < '2026-01-01'
        GROUP BY z.zone_name
        ORDER BY revenue DESC
        LIMIT 5
        """,
    ),
    (
        "User Conversion Funnel",
        """
        WITH stage_map AS (
          SELECT * FROM (VALUES
            ('app_open','App Open',1),
            ('restaurant_view','Restaurant View',2),
            ('add_to_cart','Add to Cart',3),
            ('checkout_started','Checkout Started',4),
            ('payment_success','Payment Success',5)
          ) AS t(event_name, stage, stage_order)
        )
        SELECT m.stage, COALESCE(COUNT(DISTINCT e.session_id), 0) AS users
        FROM stage_map m
        LEFT JOIN events e ON e.event_name = m.event_name
          AND e.event_timestamp >= '2025-06-01'
        GROUP BY m.stage, m.stage_order
        ORDER BY m.stage_order
        """,
    ),
    (
        "Daily Sessions",
        """
        SELECT
          DATE(event_timestamp) as date,
          platform,
          COUNT(DISTINCT session_id) as total_sessions
        FROM events
        WHERE event_timestamp >= '2025-12-01'
        GROUP BY DATE(event_timestamp), platform
        ORDER BY date, platform
        """,
    ),
    (
        "Average Events per Session",
        """
        SELECT
          DATE_TRUNC('month', event_timestamp) as month_start,
          ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT session_id), 2) as events_per_session,
          ROUND(COUNT(DISTINCT session_id) * 1.0 / COUNT(DISTINCT user_id), 2) as avg_sessions_per_user_per_week
        FROM events
        WHERE event_timestamp >= '2025-01-01'
        GROUP BY DATE_TRUNC('month', event_timestamp)
        ORDER BY month_start
        """,
    ),
    (
        "Conversion Rate Trend",
        """
        WITH weekly_funnel AS (
          SELECT
            DATE_TRUNC('week', event_timestamp) as week,
            COUNT(DISTINCT CASE WHEN event_name = 'app_open' THEN user_id END) as app_opens,
            COUNT(DISTINCT CASE WHEN event_name = 'payment_success' THEN user_id END) as conversions
          FROM events
          WHERE event_timestamp >= '2025-12-01'
          GROUP BY DATE_TRUNC('week', event_timestamp)
        )
        SELECT
          week,
          ROUND(conversions * 100.0 / NULLIF(app_opens, 0), 2) as conversion_rate_pct
        FROM weekly_funnel
        WHERE app_opens > 0
        ORDER BY week
        """,
    ),
    (
        "File Events by Mode and Type",
        """
        SELECT
          SPLIT_PART(file_path, '/', 2) AS mode,
          file_type,
          COUNT(*) AS events
        FROM file_events
        WHERE event_type = 'read_direct'
        GROUP BY mode, file_type
        ORDER BY events DESC
        """,
    ),
    (
        "Files Created Over Time",
        """
        SELECT
          DATE_TRUNC('day', timestamp) AS day,
          SPLIT_PART(file_path, '/', 2) AS mode,
          COUNT(*) AS files_created
        FROM file_events
        WHERE event_type = 'created'
        GROUP BY day, mode
        ORDER BY day
        """,
    ),
    (
        "Most Viewed Files",
        """
        SELECT
          file_name,
          file_path,
          file_type,
          COUNT(*) AS views
        FROM file_events
        WHERE event_type = 'read_direct'
        GROUP BY file_name, file_path, file_type
        ORDER BY views DESC
        LIMIT 20
        """,
    ),
    (
        "Top Users by Activity",
        """
        SELECT
          user_email,
          user_role,
          COUNT(*) AS total_events,
          COUNT(CASE WHEN event_type = 'read_direct' THEN 1 END) AS views,
          COUNT(CASE WHEN event_type = 'updated' THEN 1 END) AS edits,
          COUNT(CASE WHEN event_type = 'created' THEN 1 END) AS creates
        FROM file_events
        WHERE user_email IS NOT NULL
        GROUP BY user_email, user_role
        ORDER BY total_events DESC
        LIMIT 20
        """,
    ),
    (
        "Daily Active Users",
        """
        SELECT
          DATE_TRUNC('day', timestamp) AS day,
          COUNT(DISTINCT user_email) AS active_users
        FROM file_events
        GROUP BY day
        ORDER BY day
        """,
    ),
    (
        "LLM Calls by Model",
        """
        SELECT
          model,
          COUNT(*) AS calls,
          SUM(total_tokens) AS total_tokens,
          ROUND(SUM(cost), 4) AS total_cost_usd
        FROM llm_call_events
        GROUP BY model
        ORDER BY calls DESC
        """,
    ),
    (
        "Token Usage Over Time",
        """
        SELECT
          DATE_TRUNC('day', timestamp) AS day,
          model,
          SUM(total_tokens) AS tokens
        FROM llm_call_events
        GROUP BY day, model
        ORDER BY day
        """,
    ),
    (
        "Weekly LLM Cost",
        """
        SELECT
          DATE_TRUNC('week', timestamp) AS week,
          SUM(cost) AS total_cost_usd,
          COUNT(*) AS total_calls,
          SUM(total_tokens) AS total_tokens
        FROM llm_call_events
        GROUP BY week
        ORDER BY week
        """,
    ),
    (
        "Avg LLM Call Duration by Model",
        """
        SELECT
          model,
          COUNT(*) AS calls,
          ROUND(AVG(duration_s), 2) AS avg_duration_s,
          ROUND(AVG(total_tokens), 0) AS avg_tokens
        FROM llm_call_events
        GROUP BY model
        ORDER BY calls DESC
        """,
    ),
]


@pytest.mark.parametrize("name,sql", QUERIES, ids=[n for n, _ in QUERIES])
def test_template_query_parses(name, sql):
    ir = parse_sql_to_ir(sql)
    assert ir is not None
