from enum import Enum

from pydantic import BaseModel, Field

from app.shared_models import ValidationIssue


class MessageType(str, Enum):
    sync = "sync"
    # "return" is a Python keyword, so the enum member is named `response`
    # while its wire value stays "return" to match sequence-diagram
    # terminology (a reply to an earlier call).
    response = "return"


class Participant(BaseModel):
    id: str
    label: str


class Message(BaseModel):
    id: str
    source: str
    target: str
    label: str
    type: MessageType = MessageType.sync


class SequenceDiagram(BaseModel):
    participants: list[Participant] = Field(default_factory=list)
    messages: list[Message] = Field(default_factory=list)


class GenerateSequenceResponse(BaseModel):
    diagram: SequenceDiagram
    issues: list[ValidationIssue] = Field(default_factory=list)
