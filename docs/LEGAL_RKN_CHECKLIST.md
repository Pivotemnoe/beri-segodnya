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

Before public launch, define the personal data operator:

- individual entrepreneur;
- LLC;
- individual;
- another legal structure.

Fill operator details in:

- `/privacy`;
- `/personal-data-consent`;
- `/terms`;
- `/partner-terms`.

Required placeholders to replace:

- `[Полное наименование оператора]`;
- `[ИНН/ОГРН/ОГРНИП]`;
- `[Адрес]`;
- `[Email для обращений по персональным данным]`.

## Roskomnadzor Notification

Check whether Roskomnadzor notification is required for this processing. If required, submit the notification through the Roskomnadzor personal data portal before public launch.

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

Do not remove `noindex` and do not open public production until:

- operator details are filled;
- forms link to policy and consent;
- RKN notification question is resolved;
- storage location is confirmed;
- lawyer review is complete.
