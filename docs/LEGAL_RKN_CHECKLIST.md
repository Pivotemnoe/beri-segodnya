# Legal and RKN Checklist

This is a working checklist for the MVP. It is not legal advice. Before public launch, show the documents and data flow to a lawyer.

## Personal Data Collected

The site collects and stores personal data:

- name;
- phone;
- email;
- partner applications;
- contact requests;
- bookings and booking codes;
- technical request metadata where logged by the server or hosting provider.

## Operator

The operator details approved for the closed pilot are:

- ИП Темичев Константин Валерьевич;
- ИНН 230210303969;
- ОГРНИП 309230218400037;
- г. Армавир, ул. Каспарова, 27/2;
- `support@berisegodnya.ru` for privacy and support requests.

Fill operator details in:

- `/privacy`;
- `/personal-data-consent`;
- `/terms`;
- `/partner-terms`.

Production must set the matching `LEGAL_OPERATOR_*`, `LEGAL_PRIVACY_EMAIL`, and `PUBLIC_SUPPORT_EMAIL` environment values. The application must stay fail-closed if these fields are missing.

## Roskomnadzor Notification

Check whether Roskomnadzor notification is required for this processing. If required, submit the notification through the Roskomnadzor personal data portal before public launch.

Status on 2026-08-20: operator data is prepared, but registry presence or notification submission has not been independently confirmed. Treat this as an external launch gate for an unrestricted public launch.

## Data Localization

Personal data of Russian citizens must be stored in databases located in Russia. For staging/production, choose hosting and storage in Russia or confirm localization with the provider.

## Provider Contracts

Check:

- hosting provider agreement;
- data processing terms;
- backup location;
- admin access rules;
- incident response contacts.

## Internal Documents

Prepare internal documents:

- personal data processing policy;
- procedure for handling personal data subject requests;
- procedure for employee/admin access to data;
- appointed person responsible for personal data;
- backup procedure;
- data deletion procedure;
- incident response procedure.

## Launch Gate

Do not remove `noindex` or start unrestricted public promotion until:

- operator details are filled in the production environment;
- forms link to policy and consent;
- RKN notification question is resolved;
- storage location is confirmed;
- lawyer review is complete.
