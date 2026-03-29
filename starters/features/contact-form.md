---
gspec-version: 1.8.0
description: Validated contact form with email delivery and success feedback
---

# Contact Form

## Overview

A reusable contact form component that lets visitors submit a structured inquiry (name, email, optional phone, and message) which triggers a server-side email to the business. Without a contact form, visitors must manually compose an email or make a phone call — adding friction that can cause drop-off at the moment of highest intent.

## Users & Use Cases

**Primary users:** Prospective clients and general visitors who want to reach the business directly from the website.

**Key use cases:**

1. A prospective client finishes reviewing services and wants to describe their needs in a message without leaving the site or opening their email client.
2. A visitor on a mobile device quickly fills in their name, email, and a short message using touch-friendly inputs and submits it in under a minute.
3. A visitor submits the form and immediately sees confirmation that their message was received, giving them confidence to move on without follow-up.
4. A visitor makes a validation error (e.g., malformed email) and corrects it in place without losing any of the text they already typed.

## Scope

**In scope:**

- Self-contained, reusable form component that can be placed on any page (contact page, footer CTA, standalone route)
- Required fields: name, email address, message body
- Optional field: phone number
- Client-side validation with inline error feedback
- Submission to a server-side endpoint that sends the email
- Clear success and error states after submission
- Double-submission prevention
- Hidden honeypot field for basic spam prevention
- Accessible markup (labels, focus management, error announcements)
- Responsive layout for mobile through desktop

**Out of scope:**

- The server-side email-sending endpoint itself (this feature defines the client-side form and its contract with the server; the endpoint is an infrastructure concern)
- Email templates, recipient configuration, or transport provider selection
- File attachments or media uploads
- CAPTCHA or third-party bot detection services
- Auto-reply or confirmation emails sent back to the submitter
- Analytics or event tracking for form interactions
- Multi-step or wizard-style form flows

**Deferred ideas:**

- Project type or inquiry category selector
- Preferred contact time field
- CAPTCHA integration if honeypot proves insufficient
- Auto-save or draft persistence for partially completed forms
- Confirmation email sent to the submitter after successful submission

## Capabilities

- [ ] **P0**: Visitor can fill in required fields (name, email, message) and submit the form
  - Form renders name, email, and message fields, each with a visible label
  - All three fields are required; form cannot be submitted with any of them empty
  - On valid submission, form data is sent to a server-side endpoint as a structured payload
  - After successful server response, a clear success message is displayed

- [ ] **P0**: Form validates input and shows inline errors before submission
  - Empty required fields show a "required" error when the visitor attempts to submit
  - Email field validates format and shows a specific error for malformed addresses
  - Errors appear inline next to or below the relevant field
  - Existing field values are preserved when validation errors are displayed

- [ ] **P0**: Form displays clear feedback for success and error outcomes
  - On success, a thank-you or confirmation message replaces or overlays the form so the visitor knows the message was received
  - On server error, an actionable error message is shown (e.g., "Something went wrong — please try again or contact us by phone")
  - Feedback persists on screen until the visitor takes further action; it does not auto-dismiss

- [ ] **P0**: Submit control is guarded to prevent double submissions
  - The submit button is disabled (or the form is otherwise guarded) while a submission request is in flight
  - A loading indicator is visible during the request so the visitor knows the form is processing

- [ ] **P0**: Form is accessible
  - Every input has a programmatically associated label
  - Tab order follows a logical sequence through fields and the submit button
  - Validation errors are announced to assistive technology (e.g., via live regions or focus management)
  - Error messages are visible and not conveyed by color alone

- [ ] **P1**: Visitor can optionally provide a phone number
  - An optional phone number field is displayed with a clear indication that it is not required
  - The form submits successfully with or without a phone number value
  - If provided, the phone number is included in the payload sent to the server

- [ ] **P1**: Form layout is responsive across device sizes
  - On desktop, fields may be arranged in a multi-column layout where appropriate
  - On mobile, all fields stack vertically with touch-friendly input sizes (minimum 44px tap targets)
  - No horizontal scrolling at any viewport width
  - Labels remain legible and inputs remain usable at all sizes

- [ ] **P1**: Hidden honeypot field deters automated spam submissions
  - A visually hidden field is included in the form markup
  - The field is not visible or focusable to human users
  - If the honeypot field contains a value on submission, the form either silently discards the submission or the server rejects it
  - Legitimate users are never affected by the honeypot mechanism

- [ ] **P1**: Key conversion pages include a call-to-action linking to the contact form
  - Pages where visitors evaluate the business (e.g., Home, Services) include a CTA section near the bottom that directs visitors to the contact page
  - The CTA includes a clear heading and a button or link to the contact page
  - The CTA is visually distinct from surrounding content sections
  - The CTA does not duplicate the full form — it links to the dedicated contact page where the form lives

- [ ] **P2**: Form is a self-contained, reusable component
  - The form can be embedded on different pages without code duplication
  - Placement on a page does not require page-specific modifications to the form's internal logic
  - The server endpoint URL is configurable (e.g., via props, config, or environment) rather than hardcoded

## Dependencies

- **Contact Page** ([contact-page.md](contact-page.md)): The contact page is the primary intended host for this form component. The form should integrate visually alongside the static contact details already specified in that feature.
- **Form submission endpoint**: The form requires a backend that accepts the form payload and delivers the inquiry via email. This may be a server-side endpoint within the application or a third-party form service, depending on the stack's capabilities. Consult `gspec/stack.md` to determine the available approach.

> **Compatibility note**: This feature requires a form submission endpoint. Static-only stacks with no server runtime must include a third-party form submission service (check `gspec/stack.md` Section 11 — Third-Party Integrations). Full-stack stacks with backend capabilities should implement a custom server endpoint (check `gspec/stack.md` Section 5 — Backend Stack). The form's payload contract (name, email, phone, message, honeypot) remains the same regardless of approach.

## Assumptions & Risks

**Assumptions:**

- A server-side endpoint for receiving form submissions and sending email will be available at implementation time or will be built as a companion task.
- A single, fixed set of fields (name, email, optional phone, message) is sufficient for all expected inquiry types.
- The honeypot technique provides adequate spam prevention for the expected traffic level.

**Open questions:**

- Exact error response format from the server endpoint (status codes, error body structure) will be determined during implementation when the endpoint is built.

**Key risks:**

- **Server endpoint availability:** The form is inert without a functioning server endpoint. Mitigation: the form can be built and tested with a mock endpoint; the real endpoint can be connected later.
- **Spam volume:** A honeypot field alone may not stop sophisticated bots. Mitigation: monitor submission volume post-launch; CAPTCHA integration is a deferred enhancement if needed.
- **Email deliverability:** Submissions may be lost if the server-side email send fails silently. Mitigation: the server endpoint should return clear success/failure responses so the form can display accurate feedback to the visitor.

## Success Metrics

1. Visitors can successfully submit the form and receive visible confirmation on the first attempt when all fields are valid.
2. Validation errors prevent submission of incomplete or malformed data, and visitors can correct errors without re-entering other fields.
3. The form is usable and visually coherent on mobile devices (375px viewport) through desktop (1440px viewport).
4. Spam submissions (honeypot-caught) account for the majority of bot traffic, with minimal false positives affecting legitimate users.

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
