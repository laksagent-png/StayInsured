-- Defaults a fresh install needs to be immediately usable.

INSERT INTO settings (key, value) VALUES
    ('provider_name',        'My Insurance Agency'),
    ('provider_email',       ''),
    ('provider_phone',       ''),
    ('provider_address',     ''),
    ('currency',             'INR'),
    ('locale',               'en-IN'),
    ('date_format',          'dd/MM/yyyy'),
    ('reminder_send_time',   '09:00'),
    ('reminders_enabled',    'false'),
    ('digest_enabled',       'true'),
    ('desktop_alerts',       'true'),
    ('daily_send_cap',       '400'),
    ('smtp_host',            ''),
    ('smtp_port',            '587'),
    ('smtp_username',        ''),
    ('smtp_from_name',       ''),
    ('smtp_from_email',      ''),
    ('smtp_encryption',      'starttls'),
    ('dry_run',              'true'),
    ('backup_dir',           ''),
    ('backup_retention',     '14'),
    ('expiring_soon_window', '30');

INSERT INTO email_templates (name, trigger, subject, body_html) VALUES
    ('Policy expiry reminder', 'expiry_reminder',
     'Your {{category_label}} policy expires on {{expiry_date}}',
     '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">'
     || '<p>Dear {{client_name}},</p>'
     || '<p>This is a reminder that your <strong>{{category_label}}</strong> policy with '
     || '<strong>{{insurer_name}}</strong> is due to expire on <strong>{{expiry_date}}</strong>'
     || ' — that is {{days_to_expiry}} days from today.</p>'
     || '<table cellpadding="6" style="border-collapse:collapse;margin:16px 0;font-size:14px">'
     || '<tr><td style="color:#6b7280">Policy number</td><td><strong>{{policy_number}}</strong></td></tr>'
     || '<tr><td style="color:#6b7280">Insurer</td><td>{{insurer_name}}</td></tr>'
     || '<tr><td style="color:#6b7280">Plan</td><td>{{product_name}}</td></tr>'
     || '<tr><td style="color:#6b7280">Sum insured</td><td>{{sum_insured}}</td></tr>'
     || '<tr><td style="color:#6b7280">Premium</td><td>{{premium_amount}}</td></tr>'
     || '</table>'
     || '<p>To keep your cover running without a break, please renew before the expiry date. '
     || 'Reply to this email or call us and we will take care of the paperwork.</p>'
     || '<p>Warm regards,<br />{{provider_name}}<br />{{provider_phone}}</p></div>'),

    ('Final expiry notice', 'expiry_reminder',
     'Action needed: {{category_label}} policy expires {{expiry_date}}',
     '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">'
     || '<p>Dear {{client_name}},</p>'
     || '<p>Your <strong>{{category_label}}</strong> policy <strong>{{policy_number}}</strong> with '
     || '{{insurer_name}} expires on <strong>{{expiry_date}}</strong>.</p>'
     || '<p>Once a policy lapses, cover stops immediately and insurers often treat the '
     || 'replacement as a fresh policy, which can mean new waiting periods and a fresh medical review. '
     || 'Renewing before the expiry date avoids all of that.</p>'
     || '<p>Please get in touch today and we will complete the renewal for you.</p>'
     || '<p>Warm regards,<br />{{provider_name}}<br />{{provider_phone}}</p></div>'),

    ('Lapsed policy follow up', 'post_expiry',
     'Your {{category_label}} policy has lapsed',
     '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">'
     || '<p>Dear {{client_name}},</p>'
     || '<p>Our records show that policy <strong>{{policy_number}}</strong> with {{insurer_name}} '
     || 'expired on {{expiry_date}} and has not yet been renewed, so you are currently without cover.</p>'
     || '<p>Many insurers still allow a short grace window after expiry. Let us check what is '
     || 'possible for you — reply to this email or call us.</p>'
     || '<p>Warm regards,<br />{{provider_name}}<br />{{provider_phone}}</p></div>'),

    ('Renewal confirmation', 'renewal_confirmation',
     'Renewal confirmed — policy {{policy_number}}',
     '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">'
     || '<p>Dear {{client_name}},</p>'
     || '<p>Your {{category_label}} cover with {{insurer_name}} has been renewed. '
     || 'The new policy runs to <strong>{{expiry_date}}</strong>.</p>'
     || '<table cellpadding="6" style="border-collapse:collapse;margin:16px 0;font-size:14px">'
     || '<tr><td style="color:#6b7280">Policy number</td><td><strong>{{policy_number}}</strong></td></tr>'
     || '<tr><td style="color:#6b7280">Sum insured</td><td>{{sum_insured}}</td></tr>'
     || '<tr><td style="color:#6b7280">Premium paid</td><td>{{premium_amount}}</td></tr>'
     || '</table>'
     || '<p>Thank you for continuing to insure with us.</p>'
     || '<p>Warm regards,<br />{{provider_name}}<br />{{provider_phone}}</p></div>'),

    ('Provider daily digest', 'provider_digest',
     'StayInsured: {{expiring_count}} policies need attention',
     '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#1f2937">'
     || '<p>Summary for {{today}}:</p>{{{digest_table}}}</div>');

INSERT INTO reminder_rules (name, offset_days, audience, channel, template_id, sort_order)
SELECT '60 days before expiry', 60, 'client', 'email', t.id, 1 FROM email_templates t WHERE t.name = 'Policy expiry reminder';
INSERT INTO reminder_rules (name, offset_days, audience, channel, template_id, sort_order)
SELECT '30 days before expiry', 30, 'client', 'email', t.id, 2 FROM email_templates t WHERE t.name = 'Policy expiry reminder';
INSERT INTO reminder_rules (name, offset_days, audience, channel, template_id, sort_order)
SELECT '15 days before expiry', 15, 'client', 'email', t.id, 3 FROM email_templates t WHERE t.name = 'Policy expiry reminder';
INSERT INTO reminder_rules (name, offset_days, audience, channel, template_id, sort_order)
SELECT '7 days before expiry', 7, 'client', 'both', t.id, 4 FROM email_templates t WHERE t.name = 'Final expiry notice';
INSERT INTO reminder_rules (name, offset_days, audience, channel, template_id, sort_order)
SELECT '1 day before expiry', 1, 'client', 'both', t.id, 5 FROM email_templates t WHERE t.name = 'Final expiry notice';
INSERT INTO reminder_rules (name, offset_days, audience, channel, template_id, sort_order, is_active)
SELECT '7 days after expiry', -7, 'client', 'email', t.id, 6, 0 FROM email_templates t WHERE t.name = 'Lapsed policy follow up';

-- Common Indian insurers so the first policy can be entered without setup.
-- Deactivate the ones you do not deal with in Settings.
INSERT INTO insurers (name, short_code) VALUES
    ('Star Health and Allied Insurance', 'STAR'),
    ('Niva Bupa Health Insurance', 'NIVA'),
    ('Care Health Insurance', 'CARE'),
    ('Aditya Birla Health Insurance', 'ABHI'),
    ('ManipalCigna Health Insurance', 'MCHI'),
    ('HDFC ERGO General Insurance', 'HDFCERGO'),
    ('ICICI Lombard General Insurance', 'ILGI'),
    ('Bajaj Allianz General Insurance', 'BAGIC'),
    ('Tata AIG General Insurance', 'TATAAIG'),
    ('Reliance General Insurance', 'RGI'),
    ('Go Digit General Insurance', 'DIGIT'),
    ('Acko General Insurance', 'ACKO'),
    ('Cholamandalam MS General Insurance', 'CHOLAMS'),
    ('IFFCO Tokio General Insurance', 'ITGI'),
    ('The New India Assurance Company', 'NIA'),
    ('The Oriental Insurance Company', 'OICL'),
    ('United India Insurance Company', 'UIIC'),
    ('National Insurance Company', 'NIC'),
    ('Life Insurance Corporation of India', 'LIC'),
    ('HDFC Life Insurance', 'HDFCLIFE'),
    ('SBI Life Insurance', 'SBILIFE'),
    ('ICICI Prudential Life Insurance', 'IPRU'),
    ('Max Life Insurance', 'MAXLIFE'),
    ('Bajaj Allianz Life Insurance', 'BALIC'),
    ('Tata AIA Life Insurance', 'TATAAIA');
