from app.shared_models import ValidationIssue, ValidationSeverity
from app.sequence_models import SequenceDiagram


def validate_sequence_diagram(diagram: SequenceDiagram) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    participant_ids = {p.id for p in diagram.participants}
    seen_participant_ids: set[str] = set()
    for participant in diagram.participants:
        if participant.id in seen_participant_ids:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.error,
                    code="duplicate_participant_id",
                    message=f"Participant id '{participant.id}' is used by more than one participant.",
                    node_id=participant.id,
                )
            )
        seen_participant_ids.add(participant.id)

    seen_message_ids: set[str] = set()
    for message in diagram.messages:
        if message.id in seen_message_ids:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.error,
                    code="duplicate_message_id",
                    message=f"Message id '{message.id}' is used by more than one message.",
                    edge_id=message.id,
                )
            )
        seen_message_ids.add(message.id)

        if message.source not in participant_ids:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.error,
                    code="unknown_participant_source",
                    message=f"Message '{message.id}' references unknown source participant '{message.source}'.",
                    edge_id=message.id,
                )
            )
        if message.target not in participant_ids:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.error,
                    code="unknown_participant_target",
                    message=f"Message '{message.id}' references unknown target participant '{message.target}'.",
                    edge_id=message.id,
                )
            )

    if not diagram.messages:
        issues.append(
            ValidationIssue(
                severity=ValidationSeverity.warning,
                code="no_messages",
                message="The sequence diagram has no messages.",
            )
        )

    return issues
